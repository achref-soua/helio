/* eslint-disable no-console -- operator-facing script */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { chromium, type Page } from '@playwright/test';

import {
  BASE_URL,
  cleanPreviousShowrooms,
  seedShowroom,
  type Showroom,
  signUpAndOnboard,
} from './showroom';

/**
 * Renders the Helio product guide — a polished, brand-themed PDF that
 * tells the whole story: why Helio exists, what it does (with fresh
 * screenshots taken from a live seeded workspace), how to install and
 * host it for an organization, a step-by-step org setup, migration from
 * HubSpot/Mailchimp/Klaviyo, a usage guide, a light architecture tour,
 * and how to contribute. Written for both technical and non-technical
 * readers.
 *
 * Prereqs are the demo-video script's: `task up`, the web app on
 * BASE_URL, and (for the copilot screenshot) the intelligence service.
 * Run: `task product:guide`. Output: out/helio-product-guide.pdf
 * (OUT_FILE to override).
 */
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
// The guide always states the version it documents — read from the root
// package.json (kept current by release tooling) instead of hardcoding.
const VERSION = `v${
  (
    JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../../package.json'), 'utf8'),
    ) as { version: string }
  ).version
}`;
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const OUT_FILE =
  process.env.OUT_FILE ?? path.resolve(import.meta.dirname, '../../../out/helio-product-guide.pdf');
const ACCENT = '#f59e0b';
const INK = '#1c1917';
const REPO = 'https://github.com/achref-soua/helio';

// ── screenshots ────────────────────────────────────────────────────────

const SHOT_DIR = path.join(path.dirname(OUT_FILE), '.guide-shots');

async function capture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(900); // charts/canvas settle
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  console.log(`captured ${name}`);
}

async function captureShots(page: Page, showroom: Showroom): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });

  await page.goto(`${BASE_URL}/`);
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await capture(page, 'dashboard');

  await page.goto(`${BASE_URL}/contacts`);
  await page.getByRole('cell', { name: 'ada@example.com' }).waitFor();
  await capture(page, 'contacts');

  await page.goto(`${BASE_URL}/segments`);
  await page.getByRole('button', { name: 'Engaged pro customers', exact: true }).click();
  await page.getByTestId('segment-editor').waitFor();
  await capture(page, 'segments');

  await page.goto(`${BASE_URL}/emails`);
  await page.getByRole('button', { name: 'Trial ending soon', exact: true }).click();
  await page.getByTestId('template-preview').waitFor();
  await page.waitForTimeout(1200);
  await capture(page, 'emails');

  await page.goto(`${BASE_URL}/journeys`);
  await page.getByRole('button', { name: 'Trial conversion', exact: true }).click();
  await page.getByTestId('journey-canvas').waitFor();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'fit view' }).click();
  await capture(page, 'canvas');

  await page.goto(`${BASE_URL}/copilot`);
  await page.getByTestId('copilot-chat').waitFor();
  try {
    await page.getByLabel('Ask the copilot…').fill('How many pro contacts do we have?');
    await page.getByTestId('copilot-chat').getByRole('button', { name: 'Send' }).click();
    await page.getByTestId('turn-assistant').waitFor({ timeout: 45_000 });
  } catch {
    console.warn('copilot answer unavailable — capturing the page as-is');
  }
  await capture(page, 'copilot');

  await page.goto(`${BASE_URL}/p/${showroom.landingId}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await capture(page, 'landing');

  await page.goto(`${BASE_URL}/insights`);
  await page.getByTestId('funnel-steps').waitFor();
  await page.getByTestId('funnel-run').click();
  await page.waitForTimeout(1500);
  await capture(page, 'insights');

  await page.goto(`${BASE_URL}/deals`);
  await page.getByTestId('deal-card').first().waitFor();
  await capture(page, 'deals');

  await page.goto(`${BASE_URL}/scheduling`);
  await page.getByTestId('meeting-row').first().waitFor();
  await capture(page, 'scheduling');

  await page.goto(`${BASE_URL}/help`);
  await page.getByTestId('usage-guide').waitFor();
  await capture(page, 'help');

  // ── v2 screens ──────────────────────────────────────────────────────────

  // Settings: store + verify a real SMTP credential (against the local
  // Mailpit) so the vault section shows a masked, verified provider.
  await page.goto(`${BASE_URL}/settings`);
  const credentials = page.getByTestId('credentials-panel');
  await credentials.getByText('Provider credentials').waitFor();
  await credentials.getByLabel('Add a Email sending credential').click();
  await page.getByRole('option', { name: 'SMTP', exact: true }).click();
  const smtpDialog = page.getByRole('dialog');
  await smtpDialog.getByLabel('Name', { exact: true }).fill('Acme SMTP');
  await smtpDialog.getByLabel('Host', { exact: true }).fill('localhost');
  await smtpDialog.getByLabel('Port', { exact: true }).fill(process.env.SMTP_PORT ?? '1025');
  await smtpDialog.getByLabel('From email').fill('hello@acme.example');
  await smtpDialog.getByLabel('SMTP password').fill('a-sealed-example-secret');
  await smtpDialog.getByRole('button', { name: 'Save', exact: true }).click();
  const credentialRow = credentials.locator('li', { hasText: 'Acme SMTP' });
  await credentialRow.getByRole('button', { name: 'Verify' }).click();
  await credentialRow.getByText('Verified', { exact: true }).waitFor();
  // Let the verify toast dismiss so the capture is clean.
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 });
  // The vault card sits mid-page, so a viewport shot would clip it —
  // capture the panel itself, like a manual documenting one control.
  // Back off the sticky topbar so its blur never overlaps the card.
  await credentials.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -88);
  });
  await page.waitForTimeout(900);
  await credentials.screenshot({ path: path.join(SHOT_DIR, 'settings.png') });
  console.log('captured settings');

  await page.goto(`${BASE_URL}/admin/audit`);
  await page.getByTestId('audit-view').waitFor();
  await page.waitForTimeout(600);
  await capture(page, 'admin-audit');

  await page.goto(`${BASE_URL}/admin/health`);
  await page.getByTestId('health-view').waitFor();
  await page.waitForTimeout(800);
  await capture(page, 'admin-health');

  await page.goto(`${BASE_URL}/admin/database`);
  await page.getByTestId('database-studio').waitFor();
  await page.getByTestId('studio-row').first().waitFor();
  await capture(page, 'database-studio');

  await page.goto(`${BASE_URL}/companies`);
  await page.getByTestId('companies-view').waitFor();
  await capture(page, 'companies');

  // A contact's detail page — first row of the table.
  await page.goto(`${BASE_URL}/contacts`);
  await page.getByRole('cell', { name: 'ada@example.com' }).waitFor();
  await page.getByRole('link', { name: 'ada@example.com' }).click();
  await page.getByTestId('contact-detail').waitFor();
  await page.waitForTimeout(600);
  await capture(page, 'contact-detail');

  await page.goto(`${BASE_URL}/deals/reports`);
  await page.getByTestId('sales-reports').waitFor();
  await page.waitForTimeout(600);
  await capture(page, 'sales-reports');

  // The import wizard's mapping step, on a tiny in-memory CSV.
  await page.goto(`${BASE_URL}/contacts`);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.getByLabel('CSV file').setInputFiles({
    name: 'leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Email,First Name,Company,Status\njordan@northwind.io,Jordan,Northwind,subscribed\n',
    ),
  });
  await page.getByTestId('import-mapping').waitFor();
  await capture(page, 'import-wizard');
  await page.keyboard.press('Escape');
}

function img(name: string): string {
  const data = readFileSync(path.join(SHOT_DIR, `${name}.png`)).toString('base64');
  return `data:image/png;base64,${data}`;
}

// ── the document ───────────────────────────────────────────────────────

const SUN = (size: number, stroke = ACCENT) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" ` +
  'stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/>' +
  '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

function shotFigure(name: string, captionText: string, panel = false): string {
  return `<figure class="shot${panel ? ' panel' : ''}"><img src="${img(name)}" alt="" /><figcaption>${captionText}</figcaption></figure>`;
}

function buildHtml(): string {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
         color: ${INK}; font-size: 11.5px; line-height: 1.62; }
  .page { page-break-after: always; padding: 26px 6px 0; }
  .page:last-child { page-break-after: auto; }

  /* cover */
  .cover { page-break-after: always; height: 1020px; background: #100d0a; color: #fff;
           display: grid; place-items: center; border-radius: 6px; }
  .cover-inner { text-align: center; max-width: 560px; display: grid; justify-items: center; }
  .cover h1 { font-size: 52px; margin: 14px 0 0; letter-spacing: -0.02em; }
  .cover .tagline { font-size: 17px; color: rgba(255,255,255,.85); margin-top: 14px; }
  .cover .meta { color: ${ACCENT}; font-size: 12.5px; margin-top: 26px; letter-spacing: .02em; }
  .cover .sep { color: rgba(255,255,255,.35); margin: 0 9px; }
  .cover .foot { margin-top: 64px; font-size: 11px; color: rgba(255,255,255,.55); }

  h2 { font-size: 23px; letter-spacing: -0.015em; margin: 0 0 4px;
       padding-bottom: 8px; border-bottom: 2.5px solid ${ACCENT}; }
  .kicker { color: ${ACCENT}; font-weight: 700; font-size: 10.5px; text-transform: uppercase;
            letter-spacing: .09em; margin-bottom: 6px; }
  h3 { font-size: 14.5px; margin: 18px 0 4px; }
  p { margin: 7px 0; }
  .lead { font-size: 13px; color: #44403c; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { background: #faf7f2; border: 1px solid #ede6da; border-radius: 10px; padding: 12px 14px; }
  .card h4 { margin: 0 0 4px; font-size: 12.5px; }
  .card p { margin: 0; color: #57534e; font-size: 11px; }
  .shot { margin: 14px 0 6px; break-inside: avoid; }
  .block { break-inside: avoid; }
  .flow { padding: 26px 6px 0; }
  .flow .pagebreak { break-before: page; }
  .shot img { width: 100%; border: 1px solid #e7e0d4; border-radius: 10px;
              box-shadow: 0 2px 10px rgba(28,25,23,.07); }
  /* Tall panel crops (a single settings card) stay reading-size. */
  .shot.panel img { width: auto; max-width: 76%; max-height: 470px;
                    display: block; margin: 0 auto; }
  /* In the picture tour, cap height so two blocks pack per page. */
  .flow .shot img { width: auto; max-width: 100%; max-height: 360px;
                    display: block; margin: 0 auto; }
  .shot figcaption { color: #78716c; font-size: 10px; margin-top: 5px; text-align: center; }
  ol.steps { padding-left: 0; counter-reset: step; list-style: none; margin: 10px 0; }
  ol.steps li { counter-increment: step; position: relative; padding: 0 0 12px 38px; }
  ol.steps li::before { content: counter(step); position: absolute; left: 0; top: 1px;
      width: 24px; height: 24px; border-radius: 50%; background: ${ACCENT}; color: #fff;
      font-weight: 700; font-size: 12px; display: grid; place-items: center; }
  ol.steps b { display: block; font-size: 12px; }
  code, pre { font-family: ui-monospace, 'Cascadia Code', Menlo, monospace; font-size: 10.5px; }
  pre { background: #1c1917; color: #fafaf9; border-radius: 10px; padding: 13px 16px;
        overflow: hidden; line-height: 1.7; }
  pre .c { color: #a8a29e; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.5px; }
  th { text-align: left; background: #faf7f2; }
  th, td { border: 1px solid #e7e0d4; padding: 6px 9px; vertical-align: top; }
  .toc { columns: 2; gap: 30px; margin-top: 14px; }
  .toc div { break-inside: avoid; padding: 7px 0; border-bottom: 1px dotted #d6cec0;
             display: flex; gap: 10px; font-size: 12px; }
  .toc b { color: ${ACCENT}; font-variant-numeric: tabular-nums; }
  .callout { border-left: 3px solid ${ACCENT}; background: #fdf8ef; border-radius: 0 10px 10px 0;
             padding: 9px 14px; margin: 10px 0; font-size: 11px; }
  .quote { font-size: 14px; color: #44403c; font-style: italic; margin: 14px 0; }
</style></head><body>

<!-- ════════ cover ════════ -->
<div class="cover"><div class="cover-inner">
  ${SUN(64)}
  <h1>Helio</h1>
  <div class="tagline">The open-source growth platform — unify customer data, segment anyone,
  orchestrate journeys across every channel, and let AI do the heavy lifting.
  Self-hosted, on your own servers.</div>
  <div class="meta">Product guide<span class="sep">•</span>${VERSION}<span class="sep">•</span>${date}</div>
  <div class="foot">Achref Soua · ${REPO.replace('https://', '')}</div>
</div></div>

<!-- ════════ contents ════════ -->
<div class="page">
  <div class="kicker">Contents</div>
  <h2>What's inside</h2>
  <p class="lead">This guide follows one story: why Helio exists, what it does, how to get it
  running for your organization in an afternoon, how to move in from your current tool, and how
  to get the most out of it — whether you write code or write campaigns.</p>
  <div class="toc">
    <div><b>01</b> Why Helio exists</div>
    <div><b>02</b> What Helio is — for every seat in the room</div>
    <div><b>03</b> The product, in pictures</div>
    <div><b>04</b> Install it: one command, on anything</div>
    <div><b>05</b> Set up your organization, step by step</div>
    <div><b>06</b> Migrating from HubSpot, Mailchimp, or Klaviyo</div>
    <div><b>07</b> A CRM that closes the loop</div>
    <div><b>08</b> Admin: audit, reports, health, Database Studio</div>
    <div><b>09</b> Your AI key, your churn model</div>
    <div><b>10</b> The usage guide — how do I…?</div>
    <div><b>11</b> Under the hood (kept light)</div>
    <div><b>12</b> Contributing, questions &amp; contact</div>
  </div>
</div>

<!-- ════════ 01 why ════════ -->
<div class="page">
  <div class="kicker">01 · Motivation</div>
  <h2>Why Helio exists</h2>
  <p class="lead">Marketing teams today are forced into a bad trade: rent a polished platform and
  surrender your customer data and your budget to per-contact pricing — or self-host an open tool
  and give up automation, speed, or both.</p>
  <p><b>The rented suites</b> (HubSpot, Klaviyo, ActiveCampaign, Customer.io) are excellent — and
  closed. Real automation sits behind premium tiers that start around $800+/month, the bill grows
  with every contact you add, and your customer data lives in someone else's cloud, on someone
  else's terms.</p>
  <p><b>The open-source options</b> haven't kept up. Mautic is powerful but heavy and slowing.
  Listmonk is delightfully fast but stops at newsletters — no journeys, no automation. And none
  of them were designed for a world where AI drafts your segments, your emails, and your
  customer journeys.</p>
  <div class="quote">Helio is the missing option: Listmonk's speed, Mautic's automation depth,
  the polish of a commercial suite, and 2026-grade AI — open source, self-hosted, with zero
  per-contact pricing. Your data never leaves your servers.</div>
  <div class="grid2">
    <div class="card"><h4>Own the data</h4><p>Every profile, event, and click lives in your
    PostgreSQL and ClickHouse. GDPR export and delete are built in, not a support ticket.</p></div>
    <div class="card"><h4>Own the bill</h4><p>AGPL-3.0, free to run, and the cost of a contact
    is the disk space it occupies. Growth shouldn't be a pricing penalty.</p></div>
    <div class="card"><h4>AI-native, not bolted on</h4><p>Plain English becomes a segment, a
    journey, or an on-brand email — grounded in your own workspace data, never another tenant's.</p></div>
    <div class="card"><h4>Durable by design</h4><p>Journeys execute on a workflow engine that
    survives crashes, restarts, and week-long waits — no lost state, no double-sends.</p></div>
  </div>
</div>

<!-- ════════ 02 what ════════ -->
<div class="page">
  <div class="kicker">02 · Overview</div>
  <h2>What Helio is — for every seat in the room</h2>
  <p class="lead">One platform that unifies the tools a growth team usually rents separately:
  a customer data platform, a segmentation engine, an email and multi-channel sender, a visual
  journey builder, behavioral analytics, a lightweight CRM, and an AI copilot — behind one login,
  one consistent design, one deployment.</p>
  <h3>If you run marketing</h3>
  <p>Import your audience, slice it with live segments, design on-brand emails in a block editor,
  and launch automations on a drag-and-drop canvas — email, SMS, WhatsApp, web push, in-app, with
  quiet hours, frequency caps, and A/B splits. Watch opens, clicks, funnels, and revenue
  attribution in real time. Ask the copilot to draft any of it from a sentence.</p>
  <h3>If you run the company</h3>
  <p>Helio converts a five-figure annual SaaS line item into infrastructure you already pay for.
  No per-contact tax, no data processor in the middle, no feature ransom. White-label it, put it
  on your domain, and the platform is yours — audit log, SSO, and compliance included.</p>
  <h3>If you run engineering</h3>
  <p>A modern, typed monorepo: Next.js dashboard, REST gateway with OpenAPI and generated
  JS/Python SDKs, Kafka-compatible event backbone, Temporal-backed workers, Postgres with
  row-level-security tenant isolation, ClickHouse analytics, and an MCP server so your own AI
  agents can drive campaigns programmatically. One <code>docker compose up</code> brings the
  whole thing to life.</p>
  <h3>If you're an agency or consultant</h3>
  <p>Multi-tenant organizations and workspaces, role-based access, white-labeling per client,
  and migration importers mean you can move a client off their per-contact bill in a day —
  and keep them on infrastructure you control.</p>
</div>

<!-- ════════ 03 tour ════════ -->
<div class="flow">
  <div class="block">
    <div class="kicker">03 · The product, in pictures</div>
    <h2>One dashboard for the whole funnel</h2>
    <p>Contacts, live journeys, sends, and engagement, streamed from your own event store — the
    pulse of the workspace at a glance, in light and dark.</p>
    ${shotFigure('dashboard', 'The overview: KPIs and a 14-day engagement timeline.')}
  </div>
  <div class="block">
    <h3>A real customer data platform</h3>
    <p>Every person is one profile: traits, lead score, AI churn and conversion predictions,
    lists, and a full activity timeline. CSV import and export, identity by email, GDPR data
    bundles, and a suppression list that every send path respects.</p>
    ${shotFigure('contacts', 'Unified profiles with scores and AI predictions on every row.')}
  </div>
  <div class="block">
    <h3>Segments that compute live</h3>
    <p>Nest AND/OR groups over traits, behavior ("did event X at least N times in the last 30
    days"), scores, and AI predictions. Membership counts update as you edit, and stay
    continuously up to date afterwards.</p>
    ${shotFigure('segments', 'The segment editor: nested rules with a live membership preview.')}
  </div>
  <div class="block">
    <h3>Email that looks like you</h3>
    <p>Compose with blocks, personalize with tokens and fallbacks, and preview exactly what each
    contact receives. Campaigns add subject-line A/B tests with per-variant open and click
    rates; one-click unsubscribe and a preference center are wired into every send.</p>
    ${shotFigure('emails', 'The block-based email builder with a true-to-send preview.')}
  </div>
  <div class="block">
    <h3>Journeys are the centerpiece</h3>
    <p>Drag any channel onto the canvas — email, SMS, WhatsApp, web push, in-app — and wire it
    with waits, branches, A/B splits, trait updates, and webhooks. Quiet hours and frequency
    caps protect your audience. Under the hood every run is a durable workflow: kill a worker
    mid-journey and it resumes exactly where it paused, without double-sending.</p>
    ${shotFigure('canvas', 'The journey canvas: email → durable wait → A/B split into SMS and WhatsApp → in-app.')}
  </div>
  <div class="block">
    <h3>The copilot is grounded, not generic</h3>
    <p>It answers questions from tenant-scoped, read-only tools over your own workspace, and
    turns plain English into a saved segment, a validated journey wired to your real templates,
    or an on-brand email draft — always editable before anything runs. Bring your own model:
    Groq, OpenAI, Anthropic, or a local server.</p>
    ${shotFigure('copilot', 'The AI copilot: grounded answers and one-click drafts of segments, journeys, and emails.')}
  </div>
  <div class="block">
    <h3>Growth surfaces</h3>
    <p>Hosted forms, landing pages, on-site widgets, and in-app messages feed new contacts
    straight into segments and journeys — no third-party form vendor, white-labeled per
    workspace.</p>
    ${shotFigure('landing', 'A hosted landing page — block-built, brand-aware, capture-ready.')}
  </div>
  <div class="block">
    <h3>Proof, not vibes</h3>
    <p>Insights answers the harder questions: conversion funnels over the event stream, weekly
    cohort retention, multi-touch revenue attribution, and a guard-railed read-only SQL explorer
    for everything else.</p>
    ${shotFigure('insights', 'Insights: ordered funnels, with cohorts, attribution, and SQL below.')}
  </div>
  <div class="block">
    <h3>Close the loop</h3>
    <p>A lightweight CRM tracks deals through stages with tasks grouped by due date, and a
    booking page turns meetings into contacts automatically — double-booking is structurally
    impossible. Settings round it out: team roles, two-factor auth, SSO/SCIM, scoped API keys,
    outbound webhooks, white-labeling, sending-domain authentication, and a built-in
    support inbox.</p>
    ${shotFigure('deals', 'CRM-lite: deals through pipeline stages, keyboard-accessible.')}
  </div>
  <div class="block">
    ${shotFigure('scheduling', 'Scheduling: a public booking link; invitees land as meetings and contacts.')}
  </div>
  <div class="pagebreak"></div>
</div>

<!-- ════════ 04 install ════════ -->
<div class="page">
  <div class="kicker">04 · Installation</div>
  <h2>One command to a full stack</h2>
  <p class="lead">Helio ships as a Docker Compose stack with two profiles: <b>core</b> (app,
  PostgreSQL, Redis, Mailpit) for a quick start, and <b>full</b> (adds ClickHouse analytics,
  Redpanda event bus, Temporal workflows, MinIO storage) for everything in this guide.</p>
  <pre><span class="c"># macOS &amp; Linux</span>
curl -fsSL ${REPO}/releases/latest/download/install.sh | bash
<span class="c"># Windows (PowerShell)</span>
irm ${REPO}/releases/latest/download/install.ps1 | iex</pre>
  <p>That installs the <code>helio</code> command, which checks Docker, downloads the pinned
  release bundle (checksum-verified), generates every secret, starts the stack, runs the
  database migrations, and opens your browser on the first-run setup screen. One minute later
  you are inside your own Helio.</p>
  <pre>helio status      <span class="c"># every service, with versions</span>
helio update      <span class="c"># new release — with an automatic pre-update backup</span>
helio backup      <span class="c"># a checksummed local dump, on demand (nightly is automatic)</span>
helio restore &lt;file&gt;   <span class="c"># typed confirmation; rolls schema forward after restore</span>
helio doctor      <span class="c"># when something feels off</span>
helio uninstall   <span class="c"># remove the stack, keep your data (--purge-data erases it all)</span></pre>
  <p>Development email is captured by Mailpit (no real mail leaves your machine), and the demo
  seed gives you contacts, segments, templates, journeys, deals, and analytics history to click
  through immediately.</p>
  <h3>Hosting it for your organization</h3>
  <ol class="steps">
    <li><b>Pick a home.</b> A single 4&nbsp;GB VM runs the core profile comfortably; the full
    profile is happy on 8&nbsp;GB. Kubernetes users deploy the included Helm chart instead.</li>
    <li><b>Set the environment.</b> The installer wrote <code>~/.helio/.env</code> with every
    secret generated; set <code>APP_URL</code> to your domain and restart. (Building from
    source? <code>cp .env.example .env</code> — every variable is documented inline.)</li>
    <li><b>Put TLS in front.</b> Any reverse proxy works — Caddy and Traefik are one-liners;
    the deployment guide in the docs walks through both, plus a managed-cloud setup.</li>
    <li><b>Connect a real mail relay.</b> SMTP works out of the box; first-class adapters exist
    for AWS SES, Postmark, Resend, and Mailgun. Transactional and marketing streams are kept
    separate, and bounce/complaint webhooks feed the suppression list automatically.</li>
    <li><b>Back it up — already done.</b> Every install ships a backup service: nightly
    checksummed dumps under <code>~/.helio/backups</code>, run-now from Settings → Backups,
    optional passphrase encryption, and <code>helio restore</code> when you need it.</li>
  </ol>
  <div class="callout"><b>Where to go deeper:</b> the docs site that ships in the repo covers
  self-hosting, configuration reference, production hardening, Kubernetes, and a managed-cloud
  walkthrough — <code>apps/docs</code>, or the README's deployment section.</div>
</div>

<!-- ════════ 05 org setup ════════ -->
<div class="page">
  <div class="kicker">05 · First day</div>
  <h2>Set up your organization, step by step</h2>
  <ol class="steps">
    <li><b>Meet the setup screen.</b> A fresh install opens on one form: your name, email,
    password (with a live strength meter), and the organization. One click creates everything
    and signs you in — no email round-trip on first run. After that, the instance is
    invite-only: teammates join through emailed invitations.</li>
    <li><b>Create the organization and workspace.</b> Name the org (this is what your team and
    your hosted pages show). A default workspace is created with it — use workspaces to separate
    brands or environments.</li>
    <li><b>Invite your team.</b> Settings → Members. Owners administer everything; members work
    day to day. Enterprise teams can wire SSO (OIDC) and SCIM provisioning in the same panel.</li>
    <li><b>Secure it.</b> Enable two-factor from Settings → Security — <b>any authenticator
    app works</b> (Google Authenticator, Authy, 1Password, Microsoft Authenticator…); backup
    codes cover a lost phone. Admins can require 2FA for every member, and set a password
    rotation policy (every N days, with a forced change at sign-in) in the same settings.</li>
    <li><b>Connect your real providers.</b> Settings → Provider credentials: your SMTP/
    Postmark/Resend/Mailgun email account, Twilio for SMS, WhatsApp Cloud — every secret is
    sealed in an encrypted vault, shown only masked, and every send leaves through
    <i>your</i> account with <i>your</i> From address. A test-send button proves each one.</li>
    <li><b>Bring your own AI.</b> In the same panel, paste an OpenAI / Anthropic / Groq key —
    or point Helio at a local model server (Ollama works). The copilot, predictions, and
    generators run on <i>your</i> key, never a vendor lock-in.</li>
    <li><b>Authenticate your sending domain.</b> The deliverability wizard generates your SPF,
    DKIM, and DMARC records and verifies them live, so your mail lands in inboxes, not spam.</li>
    <li><b>Make it yours.</b> Settings → Branding: display name, accent color, and logo apply to
    the dashboard and every hosted form, landing page, and booking page. White-labeled orgs drop
    the Helio footer entirely.</li>
    <li><b>Install the tracking snippet.</b> Copy the write-key snippet onto your site; page
    views and events start flowing into the timeline, segments, and analytics.</li>
    <li><b>Bring your audience.</b> Contacts → Import CSV (see the migration chapter), or let
    forms, landing pages, and the API create contacts as they come.</li>
    <li><b>Ship your first campaign.</b> Build a segment, pick a template, A/B the subject if
    you like, and send. Then automate it: a welcome journey on the canvas takes minutes — or one
    sentence to the copilot.</li>
    <li><b>Mint API keys when you need them.</b> Settings → API keys for the REST gateway and
    SDKs; outbound webhooks notify your systems on contact, deal, and task events.</li>
  </ol>
</div>

<!-- ════════ 06 migrate ════════ -->
<div class="page">
  <div class="kicker">06 · Switching</div>
  <h2>Migrating from HubSpot, Mailchimp, or Klaviyo</h2>
  <p class="lead">Moving to Helio must not mean re-subscribing people who already opted out.
  The importer detects which tool a CSV came from and maps each vendor's consent fields to the
  right Helio status — suppression carries over from day one.</p>
  <h3>The one-click way: connect the platform</h3>
  <ol class="steps">
    <li><b>Paste a token.</b> Settings → Provider credentials → HubSpot (a private-app token),
    Mailchimp (an API key), or Klaviyo (a private key). Vault-sealed, shown once.</li>
    <li><b>Pull.</b> Contacts → Import CSV → <i>Or pull straight from a platform</i>. Helio
    pages through the vendor's API — contacts, names, companies, and consent — and imports in
    the background with live progress.</li>
  </ol>
  <h3>The CSV way: a guided wizard</h3>
  <ol class="steps">
    <li><b>Export and drop the file.</b> Helio detects which tool it came from.</li>
    <li><b>Map the columns.</b> Every column gets a destination — email, names, subscription
    status, <b>company</b>, a kept attribute, or skip — pre-filled from the file's own headers
    and fully overridable.</li>
    <li><b>Preview.</b> The first rows exactly as they will land, with counts of valid, invalid,
    and duplicate rows, and how many import as unsubscribed. Nothing is written yet.</li>
    <li><b>Import in the background.</b> Live progress; existing contacts update (unsubscribes
    always stick — an import can never re-subscribe anyone); rejected rows download as a CSV
    with row numbers and reasons. Companies are matched by name or created on the spot.</li>
  </ol>
  ${shotFigure('import-wizard', 'The mapping step: every column, its example value, and where it lands.')}
  <h3>What carries over</h3>
  <table>
    <tr><th>In Helio</th><th>Set when the vendor marks a contact as…</th></tr>
    <tr><td><code>ACTIVE</code></td><td>subscribed / opted in</td></tr>
    <tr><td><code>UNSUBSCRIBED</code> + suppression</td><td>opted out, unsubscribed, or suppressed
    — Helio will never email them, on any path</td></tr>
    <tr><td>Attributes</td><td>every other column imports as a segmentable attribute
    (plan, company, custom properties…)</td></tr>
  </table>
  <p>Once contacts are in: rebuild your key segments (minutes in the editor — or describe them
  to the copilot), recreate your templates in the block editor, and replace your old automations
  with journeys. Most teams run both tools in parallel for one billing cycle, then switch DNS
  for forms and tracking and close the old account.</p>
  <div class="callout">Per-vendor walkthroughs with screenshots live in the docs:
  <code>docs/migrate</code> — From HubSpot, From Mailchimp, From Klaviyo.</div>
</div>

<!-- ════════ 07 crm v2 ════════ -->
<div class="page">
  <div class="kicker">07 · Sales</div>
  <h2>A CRM that closes the loop</h2>
  <p class="lead">Every contact and every deal now opens a full page — and the pipeline turns
  into numbers a sales lead can run a meeting on.</p>
  ${shotFigure('contact-detail', 'A contact: traits, predictions, lists, notes, deals, tasks, and the unified activity timeline.')}
  <div class="grid2">
    <div class="card"><h4>Contact &amp; deal pages</h4><p>Team notes (pinned float up), owner
    assignment, won/lost with a reason the history keeps, linked companies, and a merged
    timeline of emails, behavioral events, and recorded changes.</p></div>
    <div class="card"><h4>Companies</h4><p>The B2B account object: attach contacts and deals,
    see live counts, and let imports create accounts from a company column automatically.</p></div>
    <div class="card"><h4>A board that moves</h4><p>Drag deals between stages by the grip
    handle, tick several and move them in one go — the per-card select stays for keyboard
    users.</p></div>
    <div class="card"><h4>Sales reports</h4><p>Pipeline value by stage, win rate, average
    cycle, an honestly-labeled forecast, and the owner leaderboard — from Helio's own
    database, no analytics store required.</p></div>
  </div>
  ${shotFigure('sales-reports', 'Deals → Reports: the board as numbers.')}
</div>

<!-- ════════ 08 admin ════════ -->
<div class="page">
  <div class="kicker">08 · Control room</div>
  <h2>Admin: see everything, prove anything</h2>
  <p class="lead">The Admin section (admins and owners) is the organization's control room:
  who did what, how the system is doing, and a safe window onto your own data.</p>
  ${shotFigure('admin-audit', 'The audit log: every security-relevant action, filterable, exportable.')}
  <div class="grid2">
    <div class="card"><h4>Audit log</h4><p>Sign-ins, 2FA changes, role changes, every settings
    edit, campaign launches, imports, SQL runs — filter by action family, actor, or date, and
    export the trail as CSV.</p></div>
    <div class="card"><h4>Reports</h4><p>Messages sent per day, contact growth, top campaigns,
    journey outcomes, member activity — with CSV downloads.</p></div>
    <div class="card"><h4>System health</h4><p>Every service with its version, store
    reachability, backup freshness, and the alert bell that send/backup/model failures
    ring.</p></div>
    <div class="card"><h4>Database Studio</h4><p>Browse and safely edit your own tables —
    allow-listed models only (auth and secrets simply are not there), validated writes, full
    audit, owner-only typed-confirmation deletes.</p></div>
  </div>
  ${shotFigure('database-studio', 'The Database Studio: transparent, validated, audited.')}
  ${shotFigure('admin-health', 'System health: services, stores, backups, and alerts on one page.')}
</div>

<!-- ════════ 09 ai ════════ -->
<div class="page">
  <div class="kicker">09 · Intelligence</div>
  <h2>Your AI key, your churn model</h2>
  <p class="lead">Helio's intelligence runs on credentials you control — and if your data team
  has its own churn model, Helio will happily use theirs instead of its own.</p>
  ${shotFigure('settings', 'Provider credentials: email, SMS, WhatsApp, AI — sealed in the vault, shown only masked.', true)}
  <ol class="steps">
    <li><b>Paste your AI key.</b> OpenAI, Anthropic, Groq — or a local model server (Ollama).
    The copilot badge always shows which provider answered.</li>
    <li><b>Download training data.</b> Settings → Churn prediction model → Training CSV: the
    exact feature columns Helio computes, plus the churn label, ready for a notebook.</li>
    <li><b>Bring the model back.</b> Upload ONNX or XGBoost JSON (pickle is refused — it can
    execute code), or point Helio at your own HTTPS model server. Validation runs in a
    sandbox and explains any problem in plain words.</li>
    <li><b>Activate, then relax.</b> One model is active per workspace. If it ever fails,
    Helio marks it, raises an alert, and scores with the built-in model — predictions never
    stop.</li>
  </ol>
</div>

<!-- ════════ 10 usage ════════ -->
<div class="page">
  <div class="kicker">10 · Day to day</div>
  <h2>The usage guide — how do I…?</h2>
  ${shotFigure('help', 'The same guide lives in the product: Help → Usage guide, with deep links.')}
  <table>
    <tr><th style="width:31%">I want to…</th><th>Do this</th></tr>
    <tr><td>Find one person and their history</td><td>Contacts → search by name or email → open
    the profile for traits, scores, predictions, and the event timeline.</td></tr>
    <tr><td>Target "pro plan, engaged recently"</td><td>Segments → New segment → add an
    attribute condition (<code>plan equals pro</code>) and a behavior condition (did event in
    the last 30 days). The member count previews live; Save.</td></tr>
    <tr><td>Send this week's newsletter</td><td>Emails → build or pick a template → Campaigns →
    choose template + segment → optionally add subject B → Send. Watch opens/clicks on the
    campaign card.</td></tr>
    <tr><td>Welcome every new signup automatically</td><td>Journeys → New journey → trigger on
    your "Signed Up" event → Send email → Wait → Branch on plan → upsell or nurture. Activate.
    Or tell the copilot the same sentence and review its draft.</td></tr>
    <tr><td>Reach people off email</td><td>Add SMS, WhatsApp, web push, or in-app nodes to any
    journey. Channel credentials live in the environment; the in-app feed is one SDK call in
    your product.</td></tr>
    <tr><td>Capture leads from the website</td><td>Forms (hosted link or embed), Landing pages
    (block builder → publish), or Widgets (one-line embed). All three create contacts and can
    trigger journeys.</td></tr>
    <tr><td>Prove what's working</td><td>Insights → run the funnel for your activation steps;
    check weekly cohorts; run attribution on your conversion event to credit campaigns; drop to
    SQL for anything bespoke.</td></tr>
    <tr><td>Track a sales pipeline</td><td>Deals for stages and values, Tasks for the to-dos,
    Scheduling for a public booking link that fills the calendar (and the CRM) by itself.</td></tr>
    <tr><td>Let scores drive outreach</td><td>Contacts → Scoring rules give points per event;
    the AI adds churn risk and conversion propensity you can segment on directly.</td></tr>
    <tr><td>Automate from my own systems</td><td>Settings → API keys → use the REST gateway or
    the JS/Python SDKs; subscribe outbound webhooks; or connect an AI agent to the MCP
    server and let it drive campaigns with the same guardrails.</td></tr>
    <tr><td>Get unstuck</td><td>The Help menu (top bar) replays the product tour, opens the
    in-app usage guide, and links the docs. The life buoy files a bug straight into the
    workspace's support inbox.</td></tr>
  </table>
</div>

<!-- ════════ 08 under the hood ════════ -->
<div class="page">
  <div class="kicker">11 · For the technically curious</div>
  <h2>Under the hood, kept light</h2>
  <p class="lead">Two planes, deliberately: a TypeScript product plane and a Python intelligence
  plane, joined by typed APIs and one event stream.</p>
  <table>
    <tr><th style="width:27%">Layer</th><th>What runs there</th></tr>
    <tr><td>Dashboard</td><td>Next.js 16 + React, server components, a shadcn-based design
    system, the React Flow journey canvas.</td></tr>
    <tr><td>APIs</td><td>tRPC for the dashboard; a public REST gateway with OpenAPI 3.1 and
    generated JS + Python SDKs; inbound and outbound webhooks with signed payloads.</td></tr>
    <tr><td>Data</td><td>PostgreSQL 16 (system of record — tenant isolation enforced by
    row-level security at the database, not just the app), ClickHouse (events &amp; analytics),
    Redis (cache &amp; rate limits), Redpanda (Kafka-compatible event backbone), MinIO/S3.</td></tr>
    <tr><td>Journeys</td><td>Temporal durable workflows — every enrollment is a workflow run
    that survives crashes and restarts; waits are real timers, not cron sweeps.</td></tr>
    <tr><td>Intelligence</td><td>Python + FastAPI: the copilot, predictive scoring and churn,
    NL→segment/journey/email, and the MCP server. Provider-agnostic LLM gateway (Groq, OpenAI,
    Anthropic, Ollama, any local OpenAI-compatible server).</td></tr>
    <tr><td>Security</td><td>RBAC, 2FA, SSO/SCIM, scoped API keys, strict security headers and
    CSP, rate limits on every public surface, audit logging, GDPR export/delete, suppression
    honored on every send path, secrets only via environment.</td></tr>
    <tr><td>Operations</td><td>Health and readiness endpoints, OpenTelemetry traces, structured
    logs, graceful shutdown everywhere, a production runbook, and a k6 load-test harness.</td></tr>
  </table>
  <p>Deeper dives — C4 diagrams, ADRs for every significant decision, and the threat model —
  live in the repository under <code>docs/</code>.</p>
</div>

<!-- ════════ 09 contributing ════════ -->
<div class="page">
  <div class="kicker">12 · Join in</div>
  <h2>Contributing</h2>
  <p class="lead">Helio is AGPL-3.0 and built in the open. Contributions are welcome — the bar
  is "production-grade", and the repo is set up to help you clear it.</p>
  <ol class="steps">
    <li><b>Start from develop.</b> <code>main</code> is releases only. Branch as
    <code>feature/&lt;area&gt;-&lt;what&gt;</code> or <code>fix/&lt;what&gt;</code>.</li>
    <li><b>Keep PRs small and single-purpose.</b> One concern per PR, rebased on develop,
    squash-merged. Conventional Commits (<code>feat:</code>, <code>fix:</code>,
    <code>docs:</code>…) with lowercase subjects.</li>
    <li><b>Ship the proof with the change.</b> New code lands with tests (Vitest, pytest,
    Playwright e2e), docs for new surfaces, and <code>.env.example</code> entries for new
    configuration. <code>task verify</code> runs the whole local gate.</li>
    <li><b>Good first areas.</b> Delivery-provider adapters, importer coverage, dashboard
    polish, docs and translations — and anything labeled in the issue tracker.</li>
  </ol>
  <p>The full protocol — including security disclosures — lives in
  <code>CONTRIBUTING.md</code> and <code>SECURITY.md</code> at the repo root.</p>

  <div class="kicker" style="margin-top:30px">10 · Contact</div>
  <h2>Questions?</h2>
  <p class="lead">I'd genuinely like to hear them — bug reports, deployment war stories,
  feature ideas, or "how would I move my team onto this?".</p>
  <table>
    <tr><td style="width:27%"><b>Author</b></td><td>Achref Soua</td></tr>
    <tr><td><b>Repository</b></td><td>${REPO}</td></tr>
    <tr><td><b>Issues &amp; ideas</b></td><td>${REPO}/issues</td></tr>
  </table>
  <p style="margin-top:26px;color:#78716c">Helio ${VERSION} · AGPL-3.0 — every screenshot in this
  guide is the real product.</p>
</div>

<!-- ════════ closing ════════ -->
<div class="cover" style="page-break-after:auto"><div class="cover-inner">
  ${SUN(72)}
  <h1>Helio</h1>
</div></div>

</body></html>`;
}

// ── render ─────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  rmSync(SHOT_DIR, { recursive: true, force: true });

  await cleanPreviousShowrooms();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  try {
    await signUpAndOnboard(page);
    const showroom = await seedShowroom();
    await captureShots(page, showroom);

    const doc = await context.newPage();
    await doc.setContent(buildHtml(), { waitUntil: 'networkidle' });
    await doc.pdf({
      path: OUT_FILE,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        `<div style="width:100%;font-size:8px;color:#a8a29e;padding:0 48px;display:flex;` +
        `justify-content:space-between;font-family:sans-serif">` +
        `<span>Helio — the open-source growth platform</span>` +
        `<span class="pageNumber"></span></div>`,
      margin: { top: '40px', bottom: '46px', left: '42px', right: '42px' },
    });
  } finally {
    await browser.close();
  }
  rmSync(SHOT_DIR, { recursive: true, force: true });
  console.log(`product guide: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
