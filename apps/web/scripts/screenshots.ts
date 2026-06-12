/* eslint-disable no-console -- operator-facing script */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { createClient as createClickHouse } from '@clickhouse/client';
import { newId } from '@helio/core';
import { createPrismaClient } from '@helio/db';
import { chromium, type Page } from '@playwright/test';

/**
 * Regenerates the README/docs screenshots from a running app so they
 * never go stale: `task up && pnpm --filter @helio/web dev`, then
 * `task screenshots`. The script signs up a throwaway operator through
 * the real UI (Mailpit verification), seeds presentable demo content
 * into that fresh workspace, and captures the product in action —
 * including the journey canvas and the email builder's live preview.
 */
// Standalone script: the repo-root .env is the single config source.
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;
const OUT_DIR = path.resolve(import.meta.dirname, '../../../docs/assets');

async function cleanPreviousShowrooms(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL must be set (root .env)');
  const prisma = createPrismaClient(adminUrl);
  // Org slugs are unique; rerunning with the same display name would
  // otherwise collide. Cascades take the showroom data with it.
  await prisma.organization.deleteMany({ where: { name: 'Lumen Coffee Co.' } });
  await prisma.$disconnect();
}

async function signUpAndOnboard(page: Page): Promise<void> {
  const email = `screenshots-${Date.now()}@example.com`;
  await page.goto(`${BASE_URL}/signup`);
  await page.getByLabel('Name').fill('Avery Operator');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('screenshots-password-1');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByText('Check your email').waitFor();

  // Pull the verification link out of Mailpit.
  let url: string | null = null;
  for (let attempt = 0; attempt < 30 && !url; attempt++) {
    await page.waitForTimeout(500);
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    ).then((response) => response.json() as Promise<{ messages: Array<{ ID: string }> }>);
    const id = search.messages[0]?.ID;
    if (!id) continue;
    const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then(
      (response) => response.json() as Promise<{ Text: string }>,
    );
    url = message.Text.match(/https?:\/\/\S*verify-email\S*/)?.[0] ?? null;
  }
  if (!url) throw new Error('verification mail never arrived — is Mailpit up?');
  await page.goto(url);

  await page.getByLabel('Organization name').fill('Lumen Coffee Co.');
  await page.getByRole('button', { name: 'Create organization' }).click();
  // The first-run tour aria-hides the page behind its modal — skip it.
  await page.getByTestId('tour-skip').click();
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
}

async function seedShowroom(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL must be set (root .env)');
  const prisma = createPrismaClient(adminUrl);
  const org = await prisma.organization.findFirstOrThrow({
    where: { name: 'Lumen Coffee Co.' },
    orderBy: { createdAt: 'desc' },
  });
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { organizationId: org.id },
  });
  const ws = { organizationId: org.id, workspaceId: workspace.id };

  const people = [
    ['ada@lumen.coffee', 'Ada', 'Lovelace', 'pro', 86],
    ['grace@lumen.coffee', 'Grace', 'Hopper', 'pro', 64],
    ['alan@lumen.coffee', 'Alan', 'Turing', 'trial', 35],
    ['katherine@lumen.coffee', 'Katherine', 'Johnson', 'free', 22],
    ['edsger@lumen.coffee', 'Edsger', 'Dijkstra', 'free', 8],
    ['radia@lumen.coffee', 'Radia', 'Perlman', 'pro', 71],
  ] as const;
  for (const [email, firstName, lastName, plan, score] of people) {
    await prisma.contact.create({
      data: {
        id: newId('contact'),
        ...ws,
        email,
        firstName,
        lastName,
        attributes: { plan },
        score,
        source: 'csv-import',
      },
    });
  }

  await prisma.segment.create({
    data: {
      id: newId('seg'),
      ...ws,
      name: 'Engaged pro customers',
      description: 'Pro plan, active in the last month',
      rule: {
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'condition', target: 'attribute', key: 'plan', operator: 'equals', value: 'pro' },
          { kind: 'condition', target: 'score', operator: 'gte', value: 50 },
        ],
      },
    },
  });

  const template = await prisma.emailTemplate.create({
    data: {
      id: newId('tpl'),
      ...ws,
      name: 'Welcome series — first brew',
      subject: 'Welcome to Lumen, {{firstName|friend}} ☕',
      document: {
        blocks: [
          { id: 'b1', type: 'heading', text: 'Your first brew is on us, {{firstName|friend}}' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Thanks for joining Lumen. Here is everything you need to pull the perfect shot at home.',
          },
          {
            id: 'b3',
            type: 'button',
            label: 'Claim your starter kit',
            url: 'https://lumen.coffee/starter',
          },
          { id: 'b4', type: 'divider' },
          { id: 'b5', type: 'paragraph', text: 'Brewed with care in Copenhagen.' },
        ],
      },
    },
  });

  await prisma.campaign.create({
    data: {
      id: newId('cmp'),
      ...ws,
      name: 'October roast launch',
      templateId: template.id,
      subjectB: 'The October roast has landed 🍂',
      segmentId: (await prisma.segment.findFirstOrThrow({ where: { workspaceId: workspace.id } }))
        .id,
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  await prisma.journey.create({
    data: {
      id: newId('jny'),
      ...ws,
      name: 'Welcome series',
      status: 'ACTIVE',
      definition: {
        trigger: { type: 'event', event: 'Signed Up' },
        startNodeId: 'welcome',
        quietHours: { start: '21:00', end: '08:00', timezone: 'Europe/Copenhagen' },
        frequencyCap: { maxEmails: 3, perDays: 7 },
        nodes: [
          {
            id: 'welcome',
            type: 'send_email',
            templateId: template.id,
            position: { x: 40, y: 200 },
          },
          { id: 'soak', type: 'wait', seconds: 172800, position: { x: 40, y: 360 } },
          {
            id: 'is_pro',
            type: 'branch',
            condition: {
              kind: 'condition',
              target: 'attribute',
              key: 'plan',
              operator: 'equals',
              value: 'pro',
            },
            position: { x: 40, y: 520 },
          },
          {
            id: 'upsell',
            type: 'send_email',
            templateId: template.id,
            position: { x: 320, y: 680 },
          },
          {
            id: 'mark',
            type: 'update_trait',
            key: 'journey',
            value: 'welcomed',
            position: { x: -240, y: 680 },
          },
          { id: 'done', type: 'end', position: { x: 40, y: 840 } },
        ],
        edges: [
          { from: 'welcome', to: 'soak' },
          { from: 'soak', to: 'is_pro' },
          { from: 'is_pro', to: 'mark', label: 'yes' },
          { from: 'is_pro', to: 'upsell', label: 'no' },
          { from: 'mark', to: 'done' },
          { from: 'upsell', to: 'done' },
        ],
      },
    },
  });

  await prisma.form.create({
    data: { id: newId('form'), ...ws, name: 'Newsletter', title: 'Join the Lumen newsletter' },
  });

  // Recent sends so the KPI row reads like a working shop.
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: { workspaceId: workspace.id },
  });
  const contacts = await prisma.contact.findMany({ where: { workspaceId: workspace.id } });
  for (const contact of contacts) {
    await prisma.emailSend.create({
      data: {
        id: newId('snd'),
        ...ws,
        contactId: contact.id,
        campaignId: campaign.id,
        email: contact.email,
        subject: 'Welcome to Lumen ☕',
        status: 'SENT',
        sentAt: new Date(Date.now() - Math.floor(Math.random() * 6) * 86_400_000),
      },
    });
  }

  // Two weeks of synthetic engagement for the overview chart. Skipped
  // gracefully when ClickHouse isn't up (core profile).
  try {
    const clickhouse = createClickHouse({
      url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER ?? 'helio',
      password: process.env.CLICKHOUSE_PASSWORD ?? 'helio_dev_password',
      database: process.env.CLICKHOUSE_DB ?? 'helio',
      clickhouse_settings: { date_time_input_format: 'best_effort' },
    });
    const rows = [];
    for (let day = 13; day >= 0; day--) {
      const base = Date.now() - day * 86_400_000;
      const volume = 6 + Math.round(10 * Math.abs(Math.sin(day / 2)));
      for (let i = 0; i < volume; i++) {
        const contact = contacts[(day + i) % contacts.length]!;
        const kind = i % 4;
        rows.push({
          message_id: newId('msg'),
          organization_id: org.id,
          workspace_id: workspace.id,
          type: 'track',
          event:
            kind === 0
              ? 'Email Opened'
              : kind === 1
                ? 'Email Link Clicked'
                : kind === 2
                  ? 'Page Viewed'
                  : 'Brew Logged',
          anonymous_id: '',
          user_id: contact.email,
          properties: JSON.stringify({ campaignId: campaign.id, sendId: newId('snd') }),
          context: '{}',
          timestamp: new Date(base + i * 3_600_000).toISOString(),
          received_at: new Date(base + i * 3_600_000).toISOString(),
        });
      }
    }
    await clickhouse.insert({ table: 'events', values: rows, format: 'JSONEachRow' });
    await clickhouse.close();
  } catch {
    console.warn('ClickHouse not reachable — overview chart will be empty in captures');
  }

  await prisma.$disconnect();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await cleanPreviousShowrooms();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

async function run(page: Page) {
  await signUpAndOnboard(page);
  await seedShowroom();

  const capture = async (name: string) => {
    await page.waitForTimeout(700); // let charts/canvas settle
    const file = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`captured ${file}`);
  };

  await page.goto(`${BASE_URL}/contacts`);
  await page.getByRole('cell', { name: 'ada@lumen.coffee' }).waitFor();
  await capture('contacts');

  await page.goto(`${BASE_URL}/segments`);
  await page.getByRole('button', { name: 'Engaged pro customers', exact: true }).click();
  await page.getByTestId('segment-editor').waitFor();
  await capture('segment-builder');

  await page.goto(`${BASE_URL}/emails`);
  await page.getByRole('button', { name: 'Welcome series — first brew', exact: true }).click();
  await page.getByTestId('template-preview').waitFor();
  await page.waitForTimeout(1200); // server-rendered preview
  await capture('email-builder');

  await page.goto(`${BASE_URL}/campaigns`);
  await page.getByTestId('campaign-card').first().waitFor();
  await capture('campaigns');

  await page.goto(`${BASE_URL}/journeys`);
  await page.getByRole('button', { name: 'Welcome series', exact: true }).click();
  await page.getByTestId('journey-canvas').waitFor();
  await capture('journey-canvas');

  await page.goto(`${BASE_URL}/`);
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await capture('dashboard');

  await page.goto(`${BASE_URL}/login`);
  await capture('login');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
