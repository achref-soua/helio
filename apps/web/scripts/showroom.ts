/* eslint-disable no-console -- operator-facing tooling */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { createClient as createClickHouse } from '@clickhouse/client';
import { newId } from '@helio/core';
import { createPrismaClient, seedDemoWorkspace } from '@helio/db';
import type { Page } from '@playwright/test';

/**
 * The shared demo showroom: a throwaway operator signed up through the
 * real UI, a fully seeded workspace, and deterministic ClickHouse
 * engagement history. Used by the demo-video and product-guide scripts.
 */
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
export const ORG_NAME = 'Acme Inc.';

export function adminPrisma() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL must be set (root .env)');
  return createPrismaClient(adminUrl);
}

/** Drop earlier recording showrooms — but never the quickstart acme org. */
export async function cleanPreviousShowrooms(): Promise<void> {
  const prisma = adminPrisma();
  await prisma.organization.deleteMany({
    where: { name: ORG_NAME, NOT: { slug: 'acme' } },
  });
  await prisma.$disconnect();
}

export async function signUpAndOnboard(page: Page): Promise<void> {
  const email = `demo-video-${Date.now()}@example.com`;
  // On a wiped database /signup forwards to the first-run setup wizard,
  // which creates the admin (auto-verified), organization, and workspace
  // in one screen. The showroom data is seeded separately, so the
  // wizard's own sample data is left off.
  await page.goto(`${BASE_URL}/signup`);
  await page.waitForURL(/\/setup/, { timeout: 15_000 });
  await page.getByLabel('Your name').fill('Demo Operator');
  await page.getByLabel('Email').fill(email);
  // A strong passphrase clears the wizard's strength gate.
  await page.getByLabel('Password').fill('Acme-Growth-Engine-2026');
  await page.getByLabel('Organization name').fill(ORG_NAME);
  await page.getByTestId('setup-seed').uncheck();
  await page.evaluate(() => localStorage.setItem('helio.tour.v1.done', '1'));
  await page.getByRole('button', { name: 'Create & enter Helio' }).click();
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 20_000 });
}

const EXTRA_PEOPLE: Array<[string, string, string, string, number]> = [
  ['lena@brightscale.example', 'Lena', 'Fischer', 'pro', 77],
  ['omar@quickship.example', 'Omar', 'Haddad', 'pro', 69],
  ['yuki@papercrane.example', 'Yuki', 'Tanaka', 'trial', 47],
  ['marco@terranova.example', 'Marco', 'Rossi', 'trial', 39],
  ['ines@solstice.example', 'Ines', 'Almeida', 'pro', 82],
  ['noah@driftwood.example', 'Noah', 'Berg', 'free', 15],
  ['priya@lumenlabs.example', 'Priya', 'Sharma', 'pro', 74],
  ['tom@anchorpoint.example', 'Tom', 'Becker', 'trial', 31],
  ['sara@meridian.example', 'Sara', 'Lindqvist', 'pro', 66],
  ['diego@altamar.example', 'Diego', 'Vargas', 'free', 21],
  ['chloe@fernway.example', 'Chloe', 'Dubois', 'trial', 44],
  ['arjun@stonebridge.example', 'Arjun', 'Mehta', 'pro', 71],
  ['emma@northwind.example', 'Emma', 'Larsen', 'free', 12],
  ['felix@copperline.example', 'Felix', 'Wagner', 'trial', 36],
  ['nadia@silvergate.example', 'Nadia', 'Karimi', 'pro', 79],
  ['lucas@greenfield.example', 'Lucas', 'Moreau', 'free', 18],
  ['hana@riverstone.example', 'Hana', 'Kim', 'pro', 63],
  ['pavel@borealis.example', 'Pavel', 'Novak', 'trial', 42],
  ['amara@goldleaf.example', 'Amara', 'Okafor', 'pro', 68],
  ['jonas@windmill.example', 'Jonas', 'Visser', 'free', 24],
];

export interface Showroom {
  organizationId: string;
  workspaceId: string;
  campaignId: string;
  formId: string;
  landingId: string;
  bookingId: string;
}

export async function seedShowroom(): Promise<Showroom> {
  const prisma = adminPrisma();
  const org = await prisma.organization.findFirstOrThrow({
    where: { name: ORG_NAME, NOT: { slug: 'acme' } },
    orderBy: { createdAt: 'desc' },
  });
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { organizationId: org.id },
  });
  const ws = { organizationId: org.id, workspaceId: workspace.id };

  await seedDemoWorkspace(prisma, ws, {
    idPrefix: 'show',
    writeKeyValue: 'wk_show_0000000000000000000000000',
  });

  // Extra contacts purely for table density on camera.
  for (const [email, firstName, lastName, plan, score] of EXTRA_PEOPLE) {
    await prisma.contact.upsert({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
      update: {},
      create: {
        id: newId('contact'),
        ...ws,
        email,
        firstName,
        lastName,
        attributes: { plan },
        score,
        conversionProbability: Math.min(0.95, score / 100 + 0.05),
        churnRisk: Math.max(0.04, 0.8 - score / 100),
        predictionModel: 'seed-demo-v1',
        predictionComputedAt: new Date(),
        source: 'csv-import',
      },
    });
  }

  const campaign = await prisma.campaign.findFirstOrThrow({
    where: { workspaceId: workspace.id, name: 'June feature roundup' },
  });
  const form = await prisma.form.findFirstOrThrow({
    where: { workspaceId: workspace.id, name: 'Newsletter' },
  });
  const contacts = await prisma.contact.findMany({ where: { workspaceId: workspace.id } });
  await prisma.$disconnect();

  await seedClickHouse(ws, campaign.id, contacts.map((contact) => contact.email).sort());

  return {
    ...ws,
    campaignId: campaign.id,
    formId: form.id,
    landingId: 'lp_show_launch',
    bookingId: 'bpg_show_intro',
  };
}

/**
 * Deterministic engagement history: a 14-day timeline, an ordered funnel
 * with realistic drop-off, weekly cohort activity, and campaign touches
 * preceding conversions so attribution has something to credit.
 */
async function seedClickHouse(
  ws: { organizationId: string; workspaceId: string },
  campaignId: string,
  emails: string[],
): Promise<void> {
  const clickhouse = createClickHouse({
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER ?? 'helio',
    password: process.env.CLICKHOUSE_PASSWORD ?? 'helio_dev_password',
    database: process.env.CLICKHOUSE_DB ?? 'helio',
    clickhouse_settings: { date_time_input_format: 'best_effort' },
  });

  const DAY = 86_400_000;
  const now = Date.now();
  const rows: Array<Record<string, string>> = [];
  const push = (event: string, user: string, at: number, properties: object = {}) =>
    rows.push({
      message_id: newId('msg'),
      organization_id: ws.organizationId,
      workspace_id: ws.workspaceId,
      type: 'track',
      event,
      anonymous_id: '',
      user_id: user,
      properties: JSON.stringify(properties),
      context: '{}',
      timestamp: new Date(at).toISOString(),
      received_at: new Date(at).toISOString(),
    });

  emails.forEach((email, i) => {
    // Cohorts: first seen i%6 weeks ago, then a decaying weekly habit.
    const firstWeek = i % 6;
    for (let week = firstWeek; week >= 0; week--) {
      if ((i + week) % (week + 2) === 0 || week === firstWeek) {
        push('Active', email, now - week * 7 * DAY - (i % 5) * DAY, {});
      }
    }
    // Funnel: everyone views pricing, ~2/3 sign up, ~2/5 activate.
    const base = now - ((i % 12) + 1) * DAY;
    push('Viewed Pricing', email, base, {});
    if (i % 3 !== 0) push('Signed Up', email, base + 3_600_000, {});
    if (i % 5 < 2) push('Activated', email, base + 7_200_000, {});
    // Campaign engagement: opens/clicks split across the A/B variants.
    if (i % 4 !== 0) {
      const variant = i % 2 === 0 ? 'A' : 'B';
      const sendId = `snd_show_video_${i}`;
      push('Email Opened', email, base + 1_800_000, { campaignId, variant, sendId });
      if (i % 3 === 0) {
        push('Email Link Clicked', email, base + 2_400_000, { campaignId, variant, sendId });
      }
      // Attribution: a few openers convert after the campaign touch.
      if (i % 7 === 0) push('Order Completed', email, base + 2 * DAY, { value: 129 });
    }
    // Timeline texture for the overview chart.
    push('Page Viewed', email, now - (i % 14) * DAY - 6 * 3_600_000, {});
  });

  await clickhouse.insert({ table: 'events', values: rows, format: 'JSONEachRow' });
  await clickhouse.close();
  console.log(`ClickHouse: inserted ${rows.length} demo events`);
}
