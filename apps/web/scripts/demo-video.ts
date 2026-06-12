/* eslint-disable no-console -- operator-facing script */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { chromium, type Locator, type Page } from '@playwright/test';

import {
  BASE_URL,
  cleanPreviousShowrooms,
  seedShowroom,
  type Showroom,
  signUpAndOnboard,
} from './showroom';

/**
 * Records the full A→Z product demo as one continuous, captioned video —
 * intro card, every feature surface (CDP, segments, email, campaigns, the
 * journey canvas, the AI copilot live, growth surfaces, insights, CRM,
 * settings, help, dark mode), outro card.
 *
 * Prereqs: `task up` (Postgres/Redis/Mailpit + ClickHouse), the web app on
 * BASE_URL, and the intelligence service for the copilot scenes. Then:
 * `task demo:video`. Output: out/helio-demo.mp4 (OUT_FILE to override;
 * needs ffmpeg on PATH or FFMPEG pointing at a binary — falls back to the
 * raw .webm next to it).
 *
 * The script signs up a throwaway operator through the real UI, seeds the
 * shared showroom into that fresh workspace (plus ClickHouse engagement
 * history), and drives real screens — nothing is mocked or composited.
 */
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const OUT_FILE =
  process.env.OUT_FILE ?? path.resolve(import.meta.dirname, '../../../out/helio-demo.mp4');
const WIDTH = 1920;
const HEIGHT = 1080;
const ACCENT = '#f59e0b';

// ── cinematography ─────────────────────────────────────────────────────

/**
 * A soft cursor that follows the real mouse, with a click pulse. It stays
 * invisible until the first real movement on a page, so scenes that only
 * present (title cards, the dashboard reveal) are never masked by a
 * parked cursor — it fades in when the hand actually reaches for
 * something.
 */
const CURSOR_SCRIPT = `(() => {
  if (window.__demoCursor) return;
  window.__demoCursor = true;
  const ready = () => {
    const cursor = document.createElement('div');
    cursor.id = '__demo-cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;' +
      'border-radius:50%;background:rgba(245,158,11,.28);border:2px solid rgba(245,158,11,.85);' +
      'box-shadow:0 1px 6px rgba(0,0,0,.25);pointer-events:none;z-index:2147483647;' +
      'opacity:0;transition:opacity .35s ease,transform .05s linear;transform:translate(-100px,-100px)';
    document.documentElement.appendChild(cursor);
    addEventListener('mousemove', (e) => {
      cursor.style.opacity = '1';
      cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    }, true);
    addEventListener('mousedown', () => {
      cursor.animate(
        [{ transform: cursor.style.transform + ' scale(1)' },
         { transform: cursor.style.transform + ' scale(.72)' },
         { transform: cursor.style.transform + ' scale(1)' }],
        { duration: 220 });
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', ready);
  else ready();
})()`;

async function caption(page: Page, title: string, body: string): Promise<void> {
  await page.evaluate(
    ([titleText, bodyText, accent]) => {
      document.getElementById('__demo-caption')?.remove();
      const el = document.createElement('div');
      el.id = '__demo-caption';
      el.style.cssText =
        'position:fixed;left:50%;bottom:48px;transform:translateX(-50%);max-width:760px;' +
        'background:rgba(20,16,12,.93);backdrop-filter:blur(8px);color:#fff;' +
        `border-left:3px solid ${accent};border-radius:12px;padding:14px 22px;` +
        'box-shadow:0 8px 30px rgba(0,0,0,.35);z-index:2147483646;pointer-events:none;' +
        'font-family:ui-sans-serif,system-ui,sans-serif;opacity:0;translate:0 12px;' +
        'transition:opacity .35s ease,translate .35s ease';
      el.innerHTML =
        `<div style="font-size:16px;font-weight:600;letter-spacing:-.01em">${titleText}</div>` +
        `<div style="font-size:13.5px;color:rgba(255,255,255,.78);margin-top:3px">${bodyText}</div>`;
      document.documentElement.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.translate = '0 0';
      });
    },
    [title, body, ACCENT],
  );
}

// The product logo (apps/web/src/app/icon.svg) without its tile — the
// card's night sky is the backdrop, and a warm glow does the rest.
const SUN_SVG =
  '<svg width="132" height="132" viewBox="0 0 96 96" ' +
  'style="filter:drop-shadow(0 0 28px rgba(234,148,47,.55))">' +
  '<g stroke="#ea942f" stroke-width="7" stroke-linecap="round" fill="none">' +
  '<circle cx="48" cy="48" r="14" fill="#ea942f" stroke="none"/>' +
  '<line x1="48" y1="14" x2="48" y2="22"/><line x1="48" y1="74" x2="48" y2="82"/>' +
  '<line x1="14" y1="48" x2="22" y2="48"/><line x1="74" y1="48" x2="82" y2="48"/>' +
  '<line x1="23.96" y1="23.96" x2="29.62" y2="29.62"/>' +
  '<line x1="66.38" y1="66.38" x2="72.04" y2="72.04"/>' +
  '<line x1="23.96" y1="72.04" x2="29.62" y2="66.38"/>' +
  '<line x1="66.38" y1="29.62" x2="72.04" y2="23.96"/>' +
  '</g></svg>';

// Fraunces, the product's display face. The dashboard self-hosts it via
// next/font, so the exact latin woff2 the production build serves (the
// preloaded `.p.` file in its @font-face) is lifted from disk and inlined
// — the bookend cards match the product to the glyph, with no font CDN
// to flake mid-shoot.
let frauncesFace: string | null | undefined;
function frauncesDataUri(): string | null {
  if (frauncesFace !== undefined) return frauncesFace;
  try {
    const staticDir = path.resolve(import.meta.dirname, '../.next/static');
    const chunksDir = path.join(staticDir, 'chunks');
    for (const name of readdirSync(chunksDir)) {
      if (!name.endsWith('.css')) continue;
      const css = readFileSync(path.join(chunksDir, name), 'utf8');
      const media = [
        ...css.matchAll(
          /@font-face\{[^}]*font-family:Fraunces;[^}]*url\(\.\.\/media\/([^)]+\.woff2)\)[^}]*\}/g,
        ),
      ]
        .map((match) => match[1])
        .find((file) => file.includes('-s.p.'));
      if (!media) continue;
      const buf = readFileSync(path.join(staticDir, 'media', media));
      frauncesFace = `data:font/woff2;base64,${buf.toString('base64')}`;
      return frauncesFace;
    }
    throw new Error('no Fraunces @font-face in the production build');
  } catch {
    frauncesFace = null; // Georgia stands in — still a film, never a stall.
  }
  return frauncesFace;
}

/**
 * Bookend title card: the sun rises over a night sky, then the wordmark,
 * version, and repo follow — logo, version, URL, nothing else.
 */
async function titleCard(page: Page, opts: { version: string; dwellMs: number }): Promise<void> {
  const face = frauncesDataUri();
  await page.setContent(
    `<!doctype html><html><head>
      <style>
        ${face ? `@font-face { font-family: Fraunces; src: url(${face}) format('woff2'); font-weight: 100 900; font-style: normal; }` : ''}
        html, body { margin: 0; height: 100%; }
        body {
          display: grid; place-items: center; overflow: hidden; color: #f5efe4;
          background:
            radial-gradient(1100px 700px at 50% 122%, rgba(234,148,47,.30), rgba(234,148,47,.08) 40%, transparent 64%),
            linear-gradient(180deg, #0b0e15 0%, #121720 100%);
          font-family: 'Fraunces', Georgia, serif;
        }
        .stage { display: grid; justify-items: center; }
        .sun { animation: rise 1.3s cubic-bezier(.22,.8,.3,1) both; }
        .word {
          font-size: 92px; font-weight: 600; letter-spacing: -.015em; line-height: 1;
          margin-top: 26px; animation: up .9s ease .5s both;
        }
        .pill {
          margin-top: 22px; padding: 8px 22px; border: 1px solid rgba(234,148,47,.55);
          border-radius: 999px; color: #e8b36a; font-size: 17px; letter-spacing: .18em;
          font-family: ui-sans-serif, system-ui, sans-serif; animation: up .9s ease .85s both;
        }
        .thread {
          height: 1px; margin-top: 34px;
          background: linear-gradient(90deg, transparent, rgba(234,148,47,.8), transparent);
          animation: grow 1.1s ease 1.05s both;
        }
        .url {
          margin-top: 26px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 16px; letter-spacing: .07em; color: rgba(245,239,228,.62);
          animation: up .9s ease 1.25s both;
        }
        @keyframes rise { from { opacity: 0; transform: translateY(56px) scale(.9); } to { opacity: 1; transform: none; } }
        @keyframes up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes grow { from { width: 0; } to { width: 280px; } }
      </style></head><body>
      <div class="stage">
        <div class="sun">${SUN_SVG}</div>
        <div class="word">Helio</div>
        <div class="pill">${opts.version}</div>
        <div class="thread"></div>
        <div class="url">github.com/achref-soua/helio</div>
      </div></body></html>`,
    { waitUntil: 'load' },
  );
  // The face is inline, so this resolves immediately — kept as a guard.
  await page.evaluate(() =>
    Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]),
  );
  await page.waitForTimeout(opts.dwellMs);
}

const dwell = (page: Page, ms: number) => page.waitForTimeout(ms);

// Where the hand currently rests. Playwright fires `steps` moves as fast
// as CDP accepts them (~150ms for any distance), which reads on film as a
// teleport — so movement is spread over real time below instead.
let cursorAt = { x: WIDTH - 90, y: HEIGHT - 90 };

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Ease the cursor to a point over real time — one small move per video
 * frame, duration scaled by distance — so the film shows a hand
 * travelling, never a jump cut.
 */
async function glide(page: Page, x: number, y: number, ms?: number): Promise<void> {
  const from = cursorAt;
  const distance = Math.hypot(x - from.x, y - from.y);
  const duration = ms ?? Math.min(1100, Math.max(450, distance * 1.1));
  const frames = Math.max(12, Math.round(duration / 25));
  for (let i = 1; i <= frames; i++) {
    const t = easeInOutCubic(i / frames);
    await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
    await page.waitForTimeout(25);
  }
  cursorAt = { x, y };
}

/** Move the cursor like a person, settle, then click. */
async function click(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (box) await glide(page, box.x + box.width / 2, box.y + box.height / 2);
  await dwell(page, 160);
  await locator.click();
}

/** Smooth-scroll an element into view so the camera glides, not jumps. */
async function scrollTo(page: Page, locator: Locator): Promise<void> {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await dwell(page, 1_100);
}

async function type(page: Page, locator: Locator, text: string): Promise<void> {
  await click(page, locator);
  await locator.pressSequentially(text, { delay: 34 });
}

/** Open a themed (Radix) select and pick an option. */
async function pick(page: Page, trigger: Locator, option: string): Promise<void> {
  await click(page, trigger);
  await dwell(page, 450);
  await click(page, page.getByRole('option', { name: option, exact: true }));
}

// ── the shoot ──────────────────────────────────────────────────────────

async function shoot(page: Page, showroom: Showroom): Promise<void> {
  // Navigation never moves the hand — the cursor stays out of frame until
  // a scene actually reaches for something, so reveals (the dashboard
  // sunrise, title cards) play unmasked.
  const go = (route: string) => page.goto(`${BASE_URL}${route}`);

  // 00 — intro
  await titleCard(page, { version: 'v2.0.0', dwellMs: 6_200 });

  // 01 — dashboard
  await go('/');
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await caption(
    page,
    'One dashboard for the whole funnel',
    'Contacts, live journeys, sends, and engagement — streamed from your own event store.',
  );
  await dwell(page, 7_000);

  // 02 — contacts
  await go('/contacts');
  await page.getByRole('cell', { name: 'ada@example.com' }).waitFor();
  await caption(
    page,
    'A real customer data platform',
    'Unified profiles with traits, lead scores, and AI churn & conversion predictions on every row.',
  );
  await dwell(page, 4_500);
  await type(page, page.getByLabel('Search email or name…'), 'ada');
  await dwell(page, 3_000);
  await caption(
    page,
    'Instant search and saved lists',
    'Find anyone by name or email; one-click CSV import/export and GDPR data bundles.',
  );
  await dwell(page, 4_000);

  // 03 — segments
  await go('/segments');
  await click(page, page.getByRole('button', { name: 'Engaged pro customers', exact: true }));
  await page.getByTestId('segment-editor').waitFor();
  await caption(
    page,
    'Segments that compute live',
    'Nested AND/OR rules over traits, behavior, scores, and AI predictions — membership previews as you edit.',
  );
  await dwell(page, 8_500);

  // 04 — emails
  await go('/emails');
  await click(page, page.getByRole('button', { name: 'Trial ending soon', exact: true }));
  await page.getByTestId('template-preview').waitFor();
  await caption(
    page,
    'A block-based email builder',
    'Headings, copy, buttons, personalization tokens — previewed exactly as each contact will see it.',
  );
  await dwell(page, 8_500);

  // 05 — campaigns
  await go('/campaigns');
  await page.getByTestId('campaign-card').first().waitFor();
  await caption(
    page,
    'Campaigns with built-in A/B tests',
    'Subject-line variants, live open and click rates per variant, straight from the event store.',
  );
  await dwell(page, 7_500);

  // 06 — journeys list
  await go('/journeys');
  await page.getByRole('button', { name: 'Trial conversion', exact: true }).waitFor();
  await caption(
    page,
    'Durable journey orchestration',
    'Multi-step automations that survive restarts and week-long waits — no lost state, no double-sends.',
  );
  await dwell(page, 5_500);

  // 07 — the canvas (centerpiece)
  await click(page, page.getByRole('button', { name: 'Trial conversion', exact: true }));
  await page.getByTestId('journey-canvas').waitFor();
  await dwell(page, 800);
  await click(page, page.getByRole('button', { name: 'fit view' }));
  await caption(
    page,
    'The journey canvas',
    'Email with AI send-time optimization, a durable wait, then an A/B split into SMS and WhatsApp.',
  );
  await dwell(page, 7_500);
  await caption(
    page,
    'Every channel is a node',
    'Email, SMS, WhatsApp, web push, in-app messages, webhooks, branches, traits — drag, wire, ship.',
  );
  // Slow pan down the flow — start on empty pane, well left of the nodes,
  // so the drag pans the canvas instead of moving a node.
  await glide(page, 330, 460);
  await page.mouse.down();
  await glide(page, 410, 880, 2_200);
  await page.mouse.up();
  await dwell(page, 4_500);
  await caption(
    page,
    'Powered by Temporal',
    'Kill a worker mid-journey and nothing is lost — runs resume exactly where they paused.',
  );
  await dwell(page, 5_500);

  // 08 — copilot, live
  await go('/copilot');
  await page.getByTestId('copilot-chat').waitFor();
  await caption(
    page,
    'An AI copilot grounded in your data',
    'It answers from tenant-scoped tools over your own workspace — never another customer’s.',
  );
  await type(page, page.getByLabel('Ask the copilot…'), 'How many pro contacts do we have?');
  await click(page, page.getByTestId('copilot-chat').getByRole('button', { name: 'Send' }));
  await page.getByTestId('turn-assistant').waitFor({ timeout: 45_000 });
  // Let the streamed answer settle on screen before moving on.
  await dwell(page, 6_500);

  await caption(
    page,
    'Plain English → a working journey',
    'Describe the flow; Helio drafts it, wires your real templates, and validates the graph.',
  );
  await type(
    page,
    page.getByLabel('e.g. welcome email, wait 2 days, then upsell pro users'),
    'when someone signs up, send the welcome email, wait 2 days, then upsell pro users',
  );
  await click(page, page.getByTestId('copilot-journey').getByRole('button', { name: 'Draft' }));
  // Show the drafted step-by-step preview, then save the real journey.
  await page.getByTestId('journey-draft-steps').waitFor({ timeout: 60_000 });
  await dwell(page, 5_000);
  await click(page, page.getByRole('button', { name: 'Create this journey' }));
  await dwell(page, 3_500);

  await caption(
    page,
    'On-brand email drafts',
    'Generation is grounded in your past subject lines and lands as an editable template.',
  );
  await type(
    page,
    page.getByLabel('e.g. win back trial users whose trial ends this week'),
    're-engage customers who have not opened our emails this month',
  );
  await click(page, page.getByTestId('copilot-email').getByRole('button', { name: 'Draft' }));
  await page.getByTestId('email-draft').waitFor({ timeout: 60_000 });
  // The live email preview renders inside the draft card.
  await page
    .getByTestId('email-draft-preview')
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await dwell(page, 6_500);

  // 09 — the AI journey, opened on the canvas
  await go('/journeys');
  await caption(
    page,
    'The copilot’s journey is real',
    'It appears beside the hand-built ones — open it, tweak it, activate it.',
  );
  await dwell(page, 5_000);

  // 10 — growth surfaces
  await go('/forms');
  await page.getByTestId('form-card').first().waitFor();
  await caption(
    page,
    'Hosted forms',
    'Share a link or embed it; submissions become contacts and can trigger journeys instantly.',
  );
  await dwell(page, 5_500);

  await go(`/f/${showroom.formId}`);
  await page.getByRole('button', { name: 'Sign up' }).waitFor();
  await caption(
    page,
    'A visitor signs up…',
    'Served by Helio itself — no third-party form vendor, white-labeled per workspace.',
  );
  await type(page, page.getByLabel('Email'), 'lena@brightscale.example');
  await click(page, page.getByRole('button', { name: 'Sign up' }));
  await dwell(page, 3_000);

  await go(`/p/${showroom.landingId}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await caption(
    page,
    'Landing pages, hosted and conversion-ready',
    'Block-built, brand-aware, with signup capture wired straight into the CDP.',
  );
  await dwell(page, 7_000);

  await go('/widgets');
  await caption(
    page,
    'On-site widgets',
    'Banners and popups on your own site with a one-line, write-key-scoped embed.',
  );
  await dwell(page, 5_500);

  await go('/in-app');
  await caption(
    page,
    'In-app messages',
    'Journeys queue messages for identified users; your product fetches them with the SDK.',
  );
  await dwell(page, 5_500);

  // 11 — insights
  await go('/insights');
  await page.getByTestId('funnel-steps').waitFor();
  await caption(
    page,
    'Behavioral analytics on ClickHouse',
    'Ordered funnels over millions of events — windowFunnel, not a nightly batch job.',
  );
  await click(page, page.getByTestId('funnel-run'));
  await dwell(page, 6_000);
  await caption(
    page,
    'Cohort retention',
    'Weekly cohorts and how long they stay active — computed straight from the event stream.',
  );
  await scrollTo(page, page.getByRole('heading', { name: 'Cohort retention' }));
  await dwell(page, 6_000);
  await scrollTo(page, page.getByRole('heading', { name: 'Multi-touch attribution' }));
  await caption(
    page,
    'Multi-touch attribution',
    'First-touch, last-touch, or linear credit for the campaigns that actually drove conversions.',
  );
  await click(page, page.getByTestId('attribution-run'));
  await dwell(page, 6_000);
  await scrollTo(page, page.getByTestId('sql-input'));
  await caption(
    page,
    'A read-only SQL explorer',
    'Ad-hoc SELECTs over your events, guard-railed to your workspace — power without foot-guns.',
  );
  await click(page, page.getByTestId('sql-run'));
  await dwell(page, 6_000);

  // 12 — CRM
  await go('/deals');
  await page.getByTestId('deal-card').first().waitFor();
  await caption(
    page,
    'CRM-lite: pipeline and deals',
    'Track revenue through stages — fully keyboard-accessible, no drag required.',
  );
  await pick(
    page,
    page.getByTestId('deal-card').filter({ hasText: 'Acme Pro — 25 seats' }).getByRole('combobox'),
    'Proposal',
  );
  await dwell(page, 4_500);

  await go('/tasks');
  await caption(
    page,
    'Sales tasks',
    'Calls, emails, and to-dos grouped by when they’re due — linked to contacts and deals.',
  );
  await dwell(page, 6_000);

  await go('/scheduling');
  await page.getByTestId('meeting-row').first().waitFor();
  await caption(
    page,
    'Meeting scheduling',
    'Share a booking link; invitees pick a slot and it lands here — double-booking is impossible.',
  );
  await dwell(page, 6_000);

  await go(`/m/${showroom.bookingId}`);
  await page.getByTestId('booking-form').waitFor();
  await caption(
    page,
    'The public booking page',
    'Slots computed in the page’s timezone, grouped by day, booked in one step.',
  );
  await click(page, page.locator('#slot'));
  await dwell(page, 1_400);
  await click(page, page.getByRole('option').nth(2));
  await type(page, page.getByLabel('Your email'), 'omar@quickship.example');
  await click(page, page.getByRole('button', { name: 'Book meeting' }));
  await dwell(page, 3_000);

  // 13 — settings
  await go('/settings');
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await caption(
    page,
    'Built for teams and compliance',
    'Members and roles, two-factor auth, SSO and SCIM, scoped API keys, audit logs.',
  );
  await dwell(page, 6_500);
  await scrollTo(page, page.getByText('Branding').first());
  await caption(
    page,
    'White-label it',
    'Your name, color, and logo on the dashboard and every hosted page. Plus webhooks and a support inbox.',
  );
  await dwell(page, 6_500);

  // 14 — help & tour
  await go('/help');
  await page.getByTestId('usage-guide').waitFor();
  await caption(
    page,
    'Help is built in',
    'A usage guide that deep-links into every feature, and a replayable product tour.',
  );
  await dwell(page, 6_000);
  await click(page, page.getByTestId('guide-tour'));
  await page.getByTestId('tour').waitFor();
  await dwell(page, 3_500);
  await click(page, page.getByTestId('tour-skip'));

  // 15 — dark mode
  await click(page, page.getByRole('button', { name: 'Toggle theme' }));
  await dwell(page, 400);
  await click(page, page.getByRole('menuitem', { name: 'Dark' }));
  await go('/');
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await caption(
    page,
    'Dark mode, end to end',
    'The whole product — canvas included — ships in light and dark.',
  );
  await dwell(page, 6_500);

  // 16 — outro
  await titleCard(page, { version: 'v2.0.0', dwellMs: 6_800 });
}

// ── output ─────────────────────────────────────────────────────────────

function convertToMp4(webm: string, mp4: string): boolean {
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  try {
    // Playwright's screencast webm is variable-frame-rate (frames only on
    // paint); some players read that as stutter. Resample to constant
    // 30fps and front-load the moov atom so the film scrubs smoothly.
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-i',
        webm,
        '-vf',
        'fps=30',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '21',
        '-movflags',
        '+faststart',
        mp4,
      ],
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const videoDir = path.join(path.dirname(OUT_FILE), '.recording');
  rmSync(videoDir, { recursive: true, force: true });

  await cleanPreviousShowrooms();

  const browser = await chromium.launch();

  // Sign up and seed off-camera, then hand the session to the recorded
  // context — the film starts exactly on the title card, no setup frames.
  const setup = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const setupPage = await setup.newPage();
  await signUpAndOnboard(setupPage);
  const showroom = await seedShowroom();
  const storageState = await setup.storageState();
  await setup.close();

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    storageState,
    recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } },
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();

  try {
    await shoot(page, showroom);
  } finally {
    await context.close();
    await browser.close();
  }

  const video = page.video();
  const webmPath = video ? await video.path() : null;
  if (!webmPath) throw new Error('no video was recorded');

  const finalWebm = OUT_FILE.replace(/\.mp4$/, '.webm');
  renameSync(webmPath, finalWebm);
  rmSync(videoDir, { recursive: true, force: true });

  if (OUT_FILE.endsWith('.mp4') && convertToMp4(finalWebm, OUT_FILE)) {
    rmSync(finalWebm);
    console.log(`demo video: ${OUT_FILE}`);
  } else {
    console.log(`demo video (webm — install ffmpeg or set FFMPEG for mp4): ${finalWebm}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
