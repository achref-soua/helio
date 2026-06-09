/* eslint-disable no-console -- seed is an operator-facing CLI script */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  emailDocumentSchema,
  journeyDefinitionSchema,
  newId,
  segmentRuleSchema,
} from '@helio/core';

import { createPrismaClient } from '../src/client';
import type { Prisma } from '../src/index';

// Standalone script: load the repo-root .env when present.
const repoRootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (fs.existsSync(repoRootEnv)) {
  process.loadEnvFile(repoRootEnv);
}

/** Validate a JSON document against its schema, then hand it to Prisma.
 *  Parsing here means the seed can never write a document the app would
 *  reject — the demo data is correct by construction. */
function json(
  schema: { parse: (value: unknown) => unknown },
  value: unknown,
): Prisma.InputJsonValue {
  return schema.parse(value) as Prisma.InputJsonValue;
}

/**
 * Seed the demo workspace. Idempotent: safe to re-run.
 * Runs with the admin connection so it can write across tenants.
 */
async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_ADMIN_URL or DATABASE_URL must be set to seed');
  }
  const prisma = createPrismaClient(url);

  const org = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { id: newId('org'), name: 'Acme Inc.', slug: 'acme' },
  });

  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'growth' } },
    update: {},
    create: { id: newId('ws'), organizationId: org.id, name: 'Growth', slug: 'growth' },
  });
  const ws = { organizationId: org.id, workspaceId: workspace.id };

  // ── Contacts ─────────────────────────────────────────────────────────
  // A spread of plans, scores, and AI predictions so segments, lead
  // scoring, and the churn/conversion columns all have something to show.
  type Seed = {
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    plan: string;
    score: number;
    status?: 'ACTIVE' | 'UNSUBSCRIBED';
    conversionProbability?: number;
    churnRisk?: number;
    bestSendHour?: number;
  };
  const demoContacts: Seed[] = [
    {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      plan: 'pro',
      score: 86,
      conversionProbability: 0.82,
      churnRisk: 0.1,
      bestSendHour: 9,
    },
    {
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      company: 'US Navy',
      plan: 'pro',
      score: 64,
      conversionProbability: 0.71,
      churnRisk: 0.18,
    },
    {
      email: 'radia@example.com',
      firstName: 'Radia',
      lastName: 'Perlman',
      company: 'Spanning Tree',
      plan: 'pro',
      score: 73,
      conversionProbability: 0.66,
      churnRisk: 0.22,
      bestSendHour: 14,
    },
    {
      email: 'margaret@example.com',
      firstName: 'Margaret',
      lastName: 'Hamilton',
      company: 'Apollo',
      plan: 'pro',
      score: 78,
      conversionProbability: 0.75,
      churnRisk: 0.14,
    },
    {
      email: 'alan@example.com',
      firstName: 'Alan',
      lastName: 'Turing',
      company: 'Bletchley Park',
      plan: 'trial',
      score: 35,
      conversionProbability: 0.44,
      churnRisk: 0.4,
    },
    {
      email: 'katherine@example.com',
      firstName: 'Katherine',
      lastName: 'Johnson',
      company: 'NASA',
      plan: 'trial',
      score: 28,
      conversionProbability: 0.33,
      churnRisk: 0.52,
    },
    {
      email: 'annie@example.com',
      firstName: 'Annie',
      lastName: 'Easley',
      company: 'NASA Lewis',
      plan: 'trial',
      score: 41,
      conversionProbability: 0.5,
      churnRisk: 0.33,
    },
    {
      email: 'edsger@example.com',
      firstName: 'Edsger',
      lastName: 'Dijkstra',
      company: 'THE',
      plan: 'free',
      score: 12,
      conversionProbability: 0.12,
      churnRisk: 0.71,
    },
    {
      email: 'hedy@example.com',
      firstName: 'Hedy',
      lastName: 'Lamarr',
      company: 'Spread Spectrum',
      plan: 'free',
      score: 19,
      conversionProbability: 0.2,
      churnRisk: 0.6,
    },
    {
      email: 'barbara@example.com',
      firstName: 'Barbara',
      lastName: 'Liskov',
      company: 'Substitution',
      plan: 'free',
      score: 8,
      status: 'UNSUBSCRIBED',
    },
  ];

  const predictedAt = new Date();
  const contacts = await Promise.all(
    demoContacts.map((c) =>
      prisma.contact.upsert({
        where: { workspaceId_email: { workspaceId: workspace.id, email: c.email } },
        update: {},
        create: {
          id: newId('contact'),
          ...ws,
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
          attributes: { plan: c.plan, company: c.company },
          score: c.score,
          status: c.status ?? 'ACTIVE',
          conversionProbability: c.conversionProbability ?? null,
          churnRisk: c.churnRisk ?? null,
          predictionModel: c.conversionProbability !== undefined ? 'seed-demo-v1' : null,
          predictionComputedAt: c.conversionProbability !== undefined ? predictedAt : null,
          bestSendHour: c.bestSendHour ?? null,
          source: 'seed',
        },
      }),
    ),
  );
  const byEmail = new Map(contacts.map((c) => [c.email, c]));

  // ── Lists ────────────────────────────────────────────────────────────
  const proList = await prisma.contactList.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Pro customers' } },
    update: {},
    create: { id: newId('list'), ...ws, name: 'Pro customers' },
  });
  await prisma.contactListMember.createMany({
    data: contacts
      .filter((c) => (c.attributes as Record<string, string>).plan === 'pro')
      .map((c) => ({ listId: proList.id, contactId: c.id, organizationId: org.id })),
    skipDuplicates: true,
  });

  // ── Segments (live predicates over the contacts above) ───────────────
  const segments: Array<{ name: string; description: string; rule: unknown }> = [
    {
      name: 'Engaged pro customers',
      description: 'Pro plan with a lead score of 50 or more',
      rule: {
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'condition', target: 'attribute', key: 'plan', operator: 'equals', value: 'pro' },
          { kind: 'condition', target: 'score', operator: 'gte', value: 50 },
        ],
      },
    },
    {
      name: 'Trial signups',
      description: 'Everyone currently on a trial',
      rule: {
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'attribute',
            key: 'plan',
            operator: 'equals',
            value: 'trial',
          },
        ],
      },
    },
    {
      name: 'High intent',
      description: 'Likely to convert — high score or AI conversion propensity',
      rule: {
        kind: 'group',
        op: 'or',
        children: [
          { kind: 'condition', target: 'score', operator: 'gte', value: 70 },
          {
            kind: 'condition',
            target: 'prediction',
            metric: 'conversionProbability',
            operator: 'gte',
            value: 0.6,
          },
        ],
      },
    },
  ];
  const segmentByName = new Map<string, { id: string }>();
  for (const s of segments) {
    const row = await prisma.segment.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: s.name } },
      update: {},
      create: {
        id: newId('seg'),
        ...ws,
        name: s.name,
        description: s.description,
        rule: json(segmentRuleSchema, s.rule),
      },
    });
    segmentByName.set(s.name, row);
  }

  // ── Email templates ──────────────────────────────────────────────────
  const welcome = await prisma.emailTemplate.upsert({
    where: {
      workspaceId_name: { workspaceId: workspace.id, name: 'Welcome series — first email' },
    },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Welcome series — first email',
      subject: 'Welcome to Acme, {{firstName|there}} 👋',
      document: json(emailDocumentSchema, {
        blocks: [
          { id: 'b1', type: 'heading', text: 'You are in, {{firstName|there}}' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Thanks for joining Acme. Here is everything you need to get your first automation live in minutes.',
          },
          { id: 'b3', type: 'button', label: 'Open the dashboard', url: 'https://example.com/app' },
          { id: 'b4', type: 'divider' },
          {
            id: 'b5',
            type: 'paragraph',
            text: 'Reply any time — a real human reads every message.',
          },
        ],
      }),
    },
  });

  const productUpdate = await prisma.emailTemplate.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Product update' } },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Product update',
      subject: 'New this month at Acme',
      document: json(emailDocumentSchema, {
        blocks: [
          { id: 'b1', type: 'heading', text: 'Fresh from the workshop' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Hi {{firstName|there}}, here is what shipped this month — including faster journeys and a new AI copilot.',
          },
          {
            id: 'b3',
            type: 'button',
            label: 'See what changed',
            url: 'https://example.com/changelog',
          },
        ],
      }),
    },
  });

  // ── Campaign (a draft the operator can review and send) ──────────────
  await prisma.campaign.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Monthly product update' } },
    update: {},
    create: {
      id: newId('cmp'),
      ...ws,
      name: 'Monthly product update',
      templateId: productUpdate.id,
      // Subject-line A/B test: template.subject is variant A.
      subjectB: 'Your Acme changelog for this month 🚀',
      segmentId: segmentByName.get('Engaged pro customers')?.id ?? null,
      status: 'DRAFT',
    },
  });

  // ── Journey (an active welcome series — survives worker restarts) ─────
  await prisma.journey.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Welcome series' } },
    update: {},
    create: {
      id: newId('jny'),
      ...ws,
      name: 'Welcome series',
      status: 'ACTIVE',
      definition: json(journeyDefinitionSchema, {
        trigger: { type: 'event', event: 'Signed Up' },
        startNodeId: 'welcome',
        quietHours: { start: '21:00', end: '08:00', timezone: 'UTC' },
        frequencyCap: { maxEmails: 3, perDays: 7 },
        nodes: [
          {
            id: 'welcome',
            type: 'send_email',
            templateId: welcome.id,
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
            templateId: productUpdate.id,
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
      }),
    },
  });

  // ── Lead-scoring rules (applied by the worker's event consumer) ──────
  const scoringRules: Array<{ event: string; points: number }> = [
    { event: 'Pricing Viewed', points: 10 },
    { event: 'Added to Cart', points: 25 },
    { event: 'Converted', points: 100 },
  ];
  for (const rule of scoringRules) {
    await prisma.scoringRule.upsert({
      where: { workspaceId_event: { workspaceId: workspace.id, event: rule.event } },
      update: {},
      create: { id: newId('score'), ...ws, event: rule.event, points: rule.points },
    });
  }

  // ── Hosted signup form ───────────────────────────────────────────────
  await prisma.form.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Newsletter' } },
    update: {},
    create: { id: newId('form'), ...ws, name: 'Newsletter', title: 'Join the Acme newsletter' },
  });

  // ── CRM: a default pipeline with stages and a few open/won deals ─────
  const pipeline = await prisma.pipeline.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'New business' } },
    update: {},
    create: { id: newId('pipe'), ...ws, name: 'New business', isDefault: true },
  });
  const stageDefs = [
    { key: 'lead', name: 'Lead', kind: 'OPEN' as const },
    { key: 'qualified', name: 'Qualified', kind: 'OPEN' as const },
    { key: 'proposal', name: 'Proposal', kind: 'OPEN' as const },
    { key: 'won', name: 'Won', kind: 'WON' as const },
    { key: 'lost', name: 'Lost', kind: 'LOST' as const },
  ];
  const stageId = new Map<string, string>();
  for (const [position, stage] of stageDefs.entries()) {
    // Deterministic id keeps the stage set idempotent (no natural unique key).
    const id = `stg_demo_${stage.key}`;
    await prisma.pipelineStage.upsert({
      where: { id },
      update: {},
      create: { id, ...ws, pipelineId: pipeline.id, name: stage.name, position, kind: stage.kind },
    });
    stageId.set(stage.key, id);
  }

  const deals: Array<{
    n: number;
    title: string;
    cents: number;
    stage: string;
    email?: string;
    status?: 'OPEN' | 'WON';
    pos: number;
  }> = [
    {
      n: 1,
      title: 'Hopper rollout',
      cents: 900_000,
      stage: 'lead',
      email: 'radia@example.com',
      pos: 0,
    },
    {
      n: 2,
      title: 'Johnson onboarding',
      cents: 300_000,
      stage: 'lead',
      email: 'katherine@example.com',
      pos: 1,
    },
    {
      n: 3,
      title: 'Acme Pro — 25 seats',
      cents: 1_500_000,
      stage: 'qualified',
      email: 'grace@example.com',
      pos: 0,
    },
    {
      n: 4,
      title: 'Lovelace Labs annual',
      cents: 4_800_000,
      stage: 'proposal',
      email: 'ada@example.com',
      pos: 0,
    },
    {
      n: 5,
      title: 'Hamilton Aerospace',
      cents: 7_200_000,
      stage: 'won',
      email: 'margaret@example.com',
      status: 'WON',
      pos: 0,
    },
  ];
  for (const deal of deals) {
    const id = `deal_demo_${deal.n}`;
    await prisma.deal.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...ws,
        pipelineId: pipeline.id,
        stageId: stageId.get(deal.stage)!,
        title: deal.title,
        valueCents: deal.cents,
        currency: 'USD',
        status: deal.status ?? 'OPEN',
        position: deal.pos,
        contactId: deal.email ? (byEmail.get(deal.email)?.id ?? null) : null,
        closedAt: deal.status === 'WON' ? predictedAt : null,
      },
    });
  }

  // ── Tasks: a spread of CRM to-dos across the due-date buckets ────────
  const DAY_MS = 86_400_000;
  const demoTasks: Array<{
    n: number;
    title: string;
    type: 'TODO' | 'CALL' | 'EMAIL' | 'MEETING';
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    dueDays: number | null;
    email?: string;
    deal?: number;
    done?: boolean;
    notes?: string;
  }> = [
    { n: 1, title: 'Call Ada about the annual renewal', type: 'CALL', priority: 'HIGH', dueDays: -2, email: 'ada@example.com', deal: 4 }, // prettier-ignore
    { n: 2, title: 'Send Acme the 25-seat proposal', type: 'EMAIL', priority: 'MEDIUM', dueDays: 0, email: 'grace@example.com', deal: 3 }, // prettier-ignore
    { n: 3, title: 'Kickoff with Hamilton Aerospace', type: 'MEETING', priority: 'MEDIUM', dueDays: 3, email: 'margaret@example.com', deal: 5 }, // prettier-ignore
    { n: 4, title: 'Follow up on the Hopper rollout', type: 'TODO', priority: 'LOW', dueDays: 6, email: 'radia@example.com', deal: 1 }, // prettier-ignore
    { n: 5, title: 'Draft the Q3 nurture sequence', type: 'TODO', priority: 'LOW', dueDays: null, notes: 'Three emails: welcome, value, ask.' }, // prettier-ignore
    { n: 6, title: 'Qualify the Johnson onboarding lead', type: 'CALL', priority: 'MEDIUM', dueDays: -1, email: 'katherine@example.com', deal: 2, done: true }, // prettier-ignore
  ];
  for (const task of demoTasks) {
    const id = `task_demo_${task.n}`;
    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...ws,
        title: task.title,
        type: task.type,
        priority: task.priority,
        status: task.done ? 'DONE' : 'OPEN',
        dueAt:
          task.dueDays === null ? null : new Date(predictedAt.getTime() + task.dueDays * DAY_MS),
        completedAt: task.done ? new Date(predictedAt.getTime() - DAY_MS) : null,
        notes: task.notes ?? null,
        contactId: task.email ? (byEmail.get(task.email)?.id ?? null) : null,
        dealId: task.deal ? `deal_demo_${task.deal}` : null,
      },
    });
  }

  // Deterministic demo write key: local-only, lets the quickstart and the
  // SDK snippet work immediately after `task up`. Never reuse in prod.
  const writeKey = await prisma.writeKey.upsert({
    where: { key: 'wk_demo_0000000000000000000000000' },
    update: {},
    create: {
      id: newId('wkey'),
      ...ws,
      key: 'wk_demo_0000000000000000000000000',
      name: 'Demo browser source',
    },
  });

  await prisma.auditLog.create({
    data: {
      id: newId('audit'),
      ...ws,
      action: 'workspace.seeded',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: { source: 'prisma/seed.ts' },
    },
  });

  console.log(
    `Seeded demo data: ${org.slug}/${workspace.slug} (${org.id}, ${workspace.id})\n` +
      `  ${contacts.length} contacts, ${segments.length} segments, 2 templates, ` +
      `1 campaign, 1 journey, ${scoringRules.length} scoring rules\n` +
      `  CRM pipeline "${pipeline.name}" with ${stageDefs.length} stages, ${deals.length} deals, and ${demoTasks.length} tasks\n` +
      `  write key ${writeKey.key}`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
