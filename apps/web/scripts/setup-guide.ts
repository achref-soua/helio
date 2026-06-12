/* eslint-disable no-console -- operator-facing tooling */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

/**
 * Renders the non-technical setup guide to a PDF. Unlike the product
 * guide, this needs no running app — it is plain-language documentation
 * of every setup step, settings panel, and parameter, illustrated with
 * the screenshots already in docs/assets. Output: out/helio-setup-guide.pdf.
 */

const ACCENT = '#ea942f';
const INK = '#1c1917';
const ASSETS = path.resolve(import.meta.dirname, '../../../docs/assets');
const OUT_FILE = path.resolve(import.meta.dirname, '../../../out/helio-setup-guide.pdf');

/** A screenshot inlined as a data URI so the PDF is self-contained. */
function shot(name: string, caption: string): string {
  const file = path.join(ASSETS, `${name}.png`);
  if (!existsSync(file)) return '';
  const data = readFileSync(file).toString('base64');
  return `<figure class="shot"><img src="data:image/png;base64,${data}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`;
}

const SETTINGS_PANELS: Array<{ name: string; who: string; what: string; params: string[] }> = [
  {
    name: 'Members & invitations',
    who: 'Admins and owners',
    what: 'Invite teammates and set what each person can do. Everyone you invite gets an email with a link to join your workspace.',
    params: [
      '<b>Email</b> — where the invitation is sent.',
      '<b>Role</b> — <i>Viewer</i> can look but not change; <i>Editor</i> runs the day-to-day (contacts, emails, campaigns, journeys); <i>Admin</i> also manages settings and teammates; <i>Owner</i> can do everything, including backups and billing-level actions. Pick the least powerful role that lets someone do their job.',
    ],
  },
  {
    name: 'Security (your account)',
    who: 'Everyone, for their own account',
    what: 'Turn on two-factor authentication and see the devices signed in to your account.',
    params: [
      '<b>Two-factor authentication</b> — adds a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy) on top of your password. Click <i>Enable</i>, scan the QR code with your phone, save the backup codes somewhere safe, and enter a code to confirm. If your organisation requires it, a banner will walk you straight here.',
      '<b>Active sessions</b> — every device signed in to your account; sign out any you don’t recognise.',
    ],
  },
  {
    name: 'Password policy',
    who: 'Admins and owners',
    what: 'Set the password rules for everyone in your organisation.',
    params: [
      '<b>Require two-factor for everyone</b> — when on, members can’t use the app until they’ve set up 2FA. The strongest single switch you can flip.',
      '<b>Password rotation</b> — optionally force everyone to choose a new password after a set number of days.',
    ],
  },
  {
    name: 'Provider credentials',
    who: 'Admins and owners',
    what: 'Connect the outside services Helio uses to actually send things and to power AI. Helio ships with nothing connected — you add only what you need. Every key you paste is encrypted and only ever shown masked.',
    params: [
      '<b>Email sending</b> — choose SMTP (works with any mail relay), or a one-click provider: Amazon SES, Postmark, Resend, or Mailgun. Paste the credentials your provider gave you; Helio sends a test to confirm before you rely on it. <i>Without this, Helio can’t send email.</i>',
      '<b>SMS</b> — connect Twilio or Vonage with your account SID and token to send text messages from journeys.',
      '<b>WhatsApp</b> — connect the WhatsApp Cloud API with your phone-number id and access token.',
      '<b>AI copilot</b> — pick your AI provider (OpenAI, Anthropic, Groq, Ollama, or any local OpenAI-compatible server), choose a model, and paste your key. A local model means your data never leaves your network. <i>Until you connect one, the copilot will say “No AI connected yet.”</i>',
    ],
  },
  {
    name: 'Churn prediction model',
    who: 'Admins and owners',
    what: 'Optionally bring your own machine-learning model that scores how likely each contact is to leave. Helio works fine without it.',
    params: [
      '<b>Upload a model</b> — an ONNX or XGBoost file you trained yourself. Helio maps its own contact features to your model automatically — there’s nothing to configure. Download the training-data CSV first, train on that, and your model plugs straight in.',
      '<b>Or connect a model server</b> — give an HTTPS URL and an optional auth header instead of uploading a file.',
    ],
  },
  {
    name: 'Single sign-on (SSO)',
    who: 'Admins and owners',
    what: 'Let your team sign in with your company identity provider (Okta, Azure AD, Google Workspace, …) instead of a separate password.',
    params: [
      '<b>Provider details</b> — the issuer URL, client id, and client secret from your identity provider. Once connected, people who use an email on your domain are routed to your provider to sign in.',
    ],
  },
  {
    name: 'SCIM provisioning',
    who: 'Admins and owners',
    what: 'Automatically create and remove Helio accounts when people join or leave, driven by your identity provider.',
    params: [
      '<b>SCIM token</b> — generate it here and paste it into your identity provider’s provisioning settings. Keep it secret; treat it like a password.',
    ],
  },
  {
    name: 'API keys',
    who: 'Admins and owners',
    what: 'Create keys so your own software (or scripts) can talk to Helio’s API.',
    params: [
      '<b>Name & scopes</b> — name the key for where it’s used, and grant only the permissions it needs. The key is shown once at creation — copy it then. Revoke any key instantly if it leaks.',
    ],
  },
  {
    name: 'Webhooks',
    who: 'Admins and owners',
    what: 'Have Helio call your own URL whenever something happens — a contact is created, a deal moves, a task is completed.',
    params: [
      '<b>Endpoint URL</b> — where Helio sends the event.',
      '<b>Events</b> — which happenings to subscribe to. Each delivery is signed so you can verify it really came from Helio, and a <i>test ping</i> lets you check your endpoint before going live.',
    ],
  },
  {
    name: 'Integrations',
    who: 'Admins and owners',
    what: 'Stream data in from the tools you already use.',
    params: [
      '<b>Shopify</b> — connect a store with its domain and webhook secret; new and updated customers and orders flow into your contacts, tagged so you can segment on them.',
      '<b>Salesforce</b> — connect an org with its instance URL and access token; new Helio contacts are pushed to Salesforce as Leads.',
    ],
  },
  {
    name: 'Branding (white-labeling)',
    who: 'Admins and owners',
    what: 'Make Helio look like your company across the app and your hosted pages.',
    params: [
      '<b>Display name</b> — replaces “Helio” in the sidebar and on hosted pages.',
      '<b>Accent colour</b> — your brand colour; it drives the highlight colour everywhere, and Helio picks a readable text colour automatically.',
      '<b>Logo</b> — paste an image URL <i>or click “Upload from device”</i> to use a file from your computer (Helio stores and serves it for you — no external host needed). A live thumbnail confirms it before you save.',
    ],
  },
  {
    name: 'Deliverability',
    who: 'Admins and owners',
    what: 'Set up email authentication so your messages reach the inbox, not spam.',
    params: [
      '<b>Sending domain</b> — add the domain you send from; Helio generates a DKIM key and shows you the exact SPF, DKIM, and DMARC records to add at your DNS host, then verifies them by live lookup. Authenticated mail is both a deliverability and a compliance requirement.',
    ],
  },
  {
    name: 'Analytics',
    who: 'Admins and owners',
    what: 'Controls for the analytics engine.',
    params: [
      '<b>Behavioural analytics</b> — when your full stack is running, this powers the dashboard timeline, funnels, cohorts, and attribution. On the lighter “core” install it’s simply off, and the rest of Helio works normally.',
    ],
  },
  {
    name: 'Backups',
    who: 'Owners',
    what: 'Protect your data. Helio backs up on a schedule, and you can run one any time.',
    params: [
      '<b>Back up now</b> — starts a backup immediately; you’ll see it appear in the list within a few seconds.',
      '<b>Download</b> — pull any backup file to keep off the server.',
      '<i>Tip: rehearse a restore once so you know it works before you ever need it.</i>',
    ],
  },
  {
    name: 'Support',
    who: 'Admins and owners',
    what: 'The in-app feedback inbox. Anyone can click the bug/feedback icon in the top bar to report something (it captures which page they were on); admins triage and resolve the reports here.',
    params: [],
  },
];

function buildHtml(): string {
  const panels = SETTINGS_PANELS.map(
    (panel, index) => `
    <section class="panel block ${index > 0 && index % 2 === 0 ? 'pagebreak' : ''}">
      <h3>${index + 1}. ${panel.name}</h3>
      <p class="who"><b>Who can use it:</b> ${panel.who}</p>
      <p>${panel.what}</p>
      ${panel.params.length ? `<ul>${panel.params.map((p) => `<li>${p}</li>`).join('')}</ul>` : ''}
    </section>`,
  ).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
         color: ${INK}; font-size: 12px; line-height: 1.62; }
  .page { padding: 22px 4px 0; }
  .cover { page-break-after: always; height: 1020px; background: #100d0a; color: #fff;
           display: grid; place-items: center; border-radius: 6px; }
  .cover-inner { text-align: center; max-width: 560px; }
  .cover h1 { font-size: 46px; margin: 10px 0 0; letter-spacing: -0.02em; }
  .cover .tagline { font-size: 16px; color: rgba(255,255,255,.85); margin-top: 14px; }
  .cover .meta { color: ${ACCENT}; font-size: 12px; margin-top: 24px; }
  .cover .foot { margin-top: 60px; font-size: 11px; color: rgba(255,255,255,.55); }
  h2 { font-size: 22px; letter-spacing: -0.015em; margin: 24px 0 4px;
       padding-bottom: 8px; border-bottom: 2.5px solid ${ACCENT}; break-after: avoid; }
  .kicker { color: ${ACCENT}; font-weight: 700; font-size: 10.5px; text-transform: uppercase;
            letter-spacing: .09em; margin: 22px 0 2px; }
  h3 { font-size: 14px; margin: 16px 0 4px; }
  p { margin: 6px 0; }
  ul { margin: 6px 0; padding-left: 18px; }
  li { margin: 4px 0; }
  .who { color: #57534e; font-size: 11px; margin: 2px 0 6px; }
  .block { break-inside: avoid; }
  .pagebreak { break-before: page; }
  ol.steps { padding-left: 0; counter-reset: step; list-style: none; margin: 10px 0; }
  ol.steps > li { counter-increment: step; position: relative; padding: 0 0 10px 34px; }
  ol.steps > li::before { content: counter(step); position: absolute; left: 0; top: -1px;
    width: 22px; height: 22px; border-radius: 50%; background: ${ACCENT}; color: #fff;
    font-weight: 700; font-size: 11px; display: grid; place-items: center; }
  code { background: #f3efe8; border: 1px solid #e7e0d4; border-radius: 5px;
         padding: 1px 5px; font-size: 11px; }
  .codeblock { background: #100d0a; color: #f5e9d8; border-radius: 8px; padding: 12px 14px;
               font-size: 11px; white-space: pre-wrap; word-break: break-all; margin: 8px 0; }
  .shot { margin: 14px 0 6px; break-inside: avoid; }
  .shot img { width: 100%; border: 1px solid #e7e0d4; border-radius: 10px;
              box-shadow: 0 2px 10px rgba(28,25,23,.07); }
  .shot figcaption { color: #78716c; font-size: 10px; margin-top: 5px; text-align: center; }
  .callout { background: #faf7f2; border: 1px solid #ede6da; border-left: 3px solid ${ACCENT};
             border-radius: 8px; padding: 10px 14px; margin: 12px 0; font-size: 11.5px; }
</style></head><body>

  <div class="cover"><div class="cover-inner">
    <div style="font-size:40px">☀</div>
    <h1>Helio Setup Guide</h1>
    <div class="tagline">A plain-language walkthrough — install Helio, complete first-run setup,
      and understand every setting and option. No technical background needed.</div>
    <div class="meta">For operators &amp; administrators</div>
    <div class="foot">The open-source growth platform · github.com/achref-soua/helio</div>
  </div></div>

  <div class="page">
    <p class="kicker">What this guide is</p>
    <h2>Before you begin</h2>
    <p>Helio is software you run yourself — on a laptop, a server, or a cloud machine — so your
      customer data stays with you. This guide takes a non-technical person from nothing to a
      fully working Helio, and then explains every setting in plain words. You don’t need to know
      how to code.</p>
    <p>The one thing your computer needs first is <b>Docker Desktop</b> — a free, normal app
      install from docker.com. On Windows, the Helio installer will even offer to set it up for
      you. Everything else, Helio handles.</p>

    <p class="kicker">Step 1</p>
    <h2>Install Helio</h2>
    <p>Pick the box for your operating system, open the terminal it names, and paste the one line.
      The installer does the rest — it checks your machine (and on Windows even offers to install
      Docker Desktop for you), downloads Helio, generates its secrets, and starts everything.</p>

    <h3>Windows 10 / 11</h3>
    <p>Open <b>PowerShell</b> (press Start, type “PowerShell”, press Enter) and paste:</p>
    <div class="codeblock">irm https://github.com/achref-soua/helio/releases/latest/download/install.ps1 | iex</div>
    <p>If Windows asks to restart after installing Docker Desktop, allow it, then run the same line
      again.</p>

    <h3>macOS (Intel or Apple Silicon)</h3>
    <p>Open the <b>Terminal</b> app (Spotlight → “Terminal”) and paste:</p>
    <div class="codeblock">curl -fsSL https://github.com/achref-soua/helio/releases/latest/download/install.sh | sh</div>
    <p>Install <a>Docker Desktop for Mac</a> first if you don’t have it — it’s a free, normal app.</p>

    <h3>Linux</h3>
    <p>Open your terminal and paste the same command:</p>
    <div class="codeblock">curl -fsSL https://github.com/achref-soua/helio/releases/latest/download/install.sh | sh</div>
    <p>You need Docker Engine (or Docker Desktop) installed — your distribution’s package manager
      or docker.com both work.</p>

    <p>When the installer says <b>“Helio is up,”</b> open your browser to
      <code>http://localhost:3000</code>.</p>
    <div class="callout"><b>Two install sizes.</b> The installer asks whether you want <b>core</b>
      (the dashboard, API, and AI copilot — lighter, ~2.5 GB of memory) or <b>full</b> (adds email
      sending, event tracking, and analytics — ~8 GB). Start with core and move up later if you
      like; nothing is lost.</div>

    <p class="kicker">Step 2</p>
    <h2>First-run setup</h2>
    <p>The very first time you open Helio, it shows a one-screen welcome wizard. Fill in:</p>
    <ol class="steps">
      <li><b>Your name</b> — how you’ll appear in the app.</li>
      <li><b>Email and password</b> — your administrator login. Choose a strong password; the
        button stays disabled until it’s strong enough.</li>
      <li><b>Organization name</b> — your company or team.</li>
      <li><b>Sample data</b> — leave this ticked the first time. It fills your workspace with
        realistic demo contacts, campaigns, journeys, and charts so nothing looks empty while you
        explore. You can delete it later.</li>
    </ol>
    <p>Click <b>Create &amp; enter Helio</b>. That’s it — you’re in, and you’re the owner. After
      this, the instance is invite-only: no one else can sign up unless you invite them.</p>
    ${shot('dashboard', 'Your dashboard after setup — KPIs, an engagement chart, and a getting-started checklist.')}
  </div>

  <div class="page">
    <p class="kicker">Step 3</p>
    <h2>Find your way around</h2>
    <p>The left sidebar groups everything the way you’ll actually use it:</p>
    <ul>
      <li><b>Audience</b> — your Contacts and the Segments you build from them.</li>
      <li><b>Engage</b> — Emails, Campaigns, Journeys, Forms, Landing pages, Widgets, and In-app messages.</li>
      <li><b>Intelligence</b> — Insights (funnels, cohorts, attribution) and the AI Copilot.</li>
      <li><b>Sales</b> — Deals, Companies, Tasks, and the meeting Scheduler.</li>
      <li><b>System</b> — Help, the Admin area, and Settings.</li>
    </ul>
    <p>The top bar has your workspace switcher, alerts, help, a feedback button, the light/dark
      theme toggle, and your account menu. A small <b>back-to-top</b> button appears when you
      scroll down a long page.</p>
    ${shot('contacts', 'Contacts —each person’s profile, traits, score, and AI predictions in one place.')}
  </div>

  <div class="page">
    <p class="kicker">Step 4</p>
    <h2>Settings, one panel at a time</h2>
    <p>Everything below lives under <b>Settings</b> (and a few under <b>Admin</b>). You only need
      the ones relevant to you — a fresh Helio works out of the box, and you add capabilities as
      you go. Each panel says who can use it and what every option does.</p>
    ${panels}
  </div>

  <div class="page">
    <p class="kicker">Day to day</p>
    <h2>Keeping Helio healthy</h2>
    <h3>Updating (every operating system)</h3>
    <p>When a new version is available, the <i>About</i> panel shows a notice. Updating is the
      same one command everywhere — open the terminal you installed from (PowerShell on Windows,
      Terminal on macOS/Linux) and run:</p>
    <div class="codeblock">helio update</div>
    <p>It takes a safety backup first, pulls the new version, runs any database upgrades, and
      restarts. Your data and settings are kept. If <code>helio</code> isn’t found, the installer
      added it during setup — close and reopen the terminal, or re-run the install line for your
      system from Step 1, which always fetches the latest.</p>
    <h3>Backups &amp; restore</h3>
    <p>Helio backs up automatically on a schedule. Run one any time with <b>Back up now</b> in
      Settings, or <code>helio backup</code> from the terminal. To restore, use
      <code>helio restore</code> — and it’s worth rehearsing once so you’re confident it works.</p>
    <h3>Uninstalling</h3>
    <p>To stop Helio but keep your data, run <code>helio down</code>. To remove it completely,
      <code>helio uninstall</code> (add <code>--purge-data</code> to erase the databases too).
      These commands are identical on Windows, macOS, and Linux.</p>
    <div class="callout"><b>You’re in control.</b> Helio collects nothing about your deployment —
      no telemetry, no analytics, no accounts with us. The only thing it ever checks online is
      whether a newer version exists, and you can turn even that off. Your customers’ data lives
      only on the machines you run.</div>
  </div>

</body></html>`;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
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
        `<span>Helio Setup Guide</span><span class="pageNumber"></span></div>`,
      margin: { top: '40px', bottom: '46px', left: '42px', right: '42px' },
    });
    console.log(`setup guide: ${OUT_FILE}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
