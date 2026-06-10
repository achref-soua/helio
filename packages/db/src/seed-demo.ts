import {
  availabilitySchema,
  DEFAULT_AVAILABILITY,
  emailDocumentSchema,
  journeyDefinitionSchema,
  landingDocumentSchema,
  newId,
  segmentRuleSchema,
} from '@helio/core';

import type { PrismaClient } from './client';
import { type Prisma } from './generated/prisma/client';

export interface SeedTarget {
  organizationId: string;
  workspaceId: string;
}

export interface SeedSummary {
  contacts: number;
  segments: number;
  templates: number;
  campaigns: number;
  sends: number;
  journeys: number;
  scoringRules: number;
  forms: number;
  meetings: number;
  pipelineName: string;
  stages: number;
  deals: number;
  tasks: number;
  writeKey: string;
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
 * Fill a workspace with the full-platform demo showroom: contacts, lists,
 * segments, templates, campaigns with sends, three journeys, growth
 * surfaces, scheduling, and a CRM pipeline. Idempotent for a given
 * `idPrefix`; pass a distinct prefix (and write key) to seed a second
 * workspace while the quickstart one exists — fixed ids would otherwise
 * collide across workspaces.
 *
 * Used by `prisma/seed.ts` (the quickstart workspace) and by the demo
 * video / screenshot tooling (throwaway showrooms).
 */
export async function seedDemoWorkspace(
  prisma: PrismaClient,
  ws: SeedTarget,
  { idPrefix = 'demo', writeKeyValue = 'wk_demo_0000000000000000000000000' } = {},
): Promise<SeedSummary> {
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
        where: { workspaceId_email: { workspaceId: ws.workspaceId, email: c.email } },
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
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Pro customers' } },
    update: {},
    create: { id: newId('list'), ...ws, name: 'Pro customers' },
  });
  await prisma.contactListMember.createMany({
    data: contacts
      .filter((c) => (c.attributes as Record<string, string>).plan === 'pro')
      .map((c) => ({ listId: proList.id, contactId: c.id, organizationId: ws.organizationId })),
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
      where: { workspaceId_name: { workspaceId: ws.workspaceId, name: s.name } },
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
      workspaceId_name: { workspaceId: ws.workspaceId, name: 'Welcome series — first email' },
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
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Product update' } },
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

  const trialEnding = await prisma.emailTemplate.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Trial ending soon' } },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Trial ending soon',
      subject: 'Your Acme trial ends in 3 days, {{firstName|there}}',
      document: json(emailDocumentSchema, {
        blocks: [
          { id: 'b1', type: 'heading', text: 'Keep your automations running' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Your trial wraps up this week. Upgrade now and everything you built — segments, journeys, templates — keeps working without a blip.',
          },
          { id: 'b3', type: 'button', label: 'Upgrade to Pro', url: 'https://example.com/upgrade' },
          { id: 'b4', type: 'divider' },
          { id: 'b5', type: 'paragraph', text: 'Questions? Just reply — we read everything.' },
        ],
      }),
    },
  });

  const winBack = await prisma.emailTemplate.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Win-back — we miss you' } },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Win-back — we miss you',
      subject: 'It has been a while, {{firstName|there}}',
      document: json(emailDocumentSchema, {
        blocks: [
          { id: 'b1', type: 'heading', text: 'Your workspace is still here' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'A lot shipped since you last logged in. Pick up where you left off — your data never went anywhere.',
          },
          { id: 'b3', type: 'button', label: 'Come back in', url: 'https://example.com/app' },
        ],
      }),
    },
  });

  // ── Campaign (a draft the operator can review and send) ──────────────
  await prisma.campaign.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Monthly product update' } },
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

  // A sent campaign with per-contact sends so the dashboard KPIs, campaign
  // engagement cards, and attribution all have history to show.
  const roundup = await prisma.campaign.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'June feature roundup' } },
    update: {},
    create: {
      id: newId('cmp'),
      ...ws,
      name: 'June feature roundup',
      templateId: productUpdate.id,
      segmentId: segmentByName.get('High intent')?.id ?? null,
      status: 'SENT',
      sentAt: new Date(predictedAt.getTime() - 5 * 86_400_000),
    },
  });
  const sendable = contacts.filter((c) => c.status === 'ACTIVE');
  for (const [index, contact] of sendable.entries()) {
    // Deterministic ids keep re-runs from duplicating sends.
    const id = `snd_${idPrefix}_${index + 1}`;
    await prisma.emailSend.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...ws,
        contactId: contact.id,
        campaignId: roundup.id,
        email: contact.email,
        subject: 'New this month at Acme',
        status: 'SENT',
        sentAt: new Date(predictedAt.getTime() - ((index % 12) + 1) * 86_400_000),
      },
    });
  }

  // ── In-app message (referenced by the trial-conversion journey) ──────
  const inAppUpgrade = await prisma.inAppMessage.upsert({
    where: { id: `iam_${idPrefix}_upgrade` },
    update: {},
    create: {
      id: `iam_${idPrefix}_upgrade`,
      ...ws,
      name: 'Upgrade nudge',
      title: 'Unlock every channel',
      body: 'Your trial includes journeys, SMS, and the AI copilot — upgrade to keep them after day 14.',
      ctaLabel: 'See plans',
      ctaUrl: 'https://example.com/pricing',
      active: true,
    },
  });

  // ── Journey (an active welcome series — survives worker restarts) ─────
  await prisma.journey.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Welcome series' } },
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

  // A multi-channel journey — the canvas showpiece: email, an A/B split
  // into SMS vs WhatsApp, and an in-app nudge, all in one flow.
  await prisma.journey.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Trial conversion' } },
    update: {},
    create: {
      id: newId('jny'),
      ...ws,
      name: 'Trial conversion',
      status: 'ACTIVE',
      definition: json(journeyDefinitionSchema, {
        trigger: { type: 'event', event: 'Trial Started' },
        startNodeId: 'heads_up',
        quietHours: { start: '21:00', end: '08:00', timezone: 'UTC' },
        frequencyCap: { maxEmails: 3, perDays: 7 },
        nodes: [
          {
            id: 'heads_up',
            type: 'send_email',
            templateId: trialEnding.id,
            optimizeSendTime: true,
            position: { x: 40, y: 160 },
          },
          { id: 'soak', type: 'wait', seconds: 86_400, position: { x: 40, y: 320 } },
          { id: 'split', type: 'ab_split', ratioA: 50, position: { x: 40, y: 480 } },
          {
            id: 'nudge_sms',
            type: 'send_sms',
            body: 'Hi {{firstName|there}} — your Acme trial ends in 3 days. Upgrade: https://example.com/upgrade',
            position: { x: -240, y: 640 },
          },
          {
            id: 'nudge_wa',
            type: 'send_whatsapp',
            body: 'Hi {{firstName|there}}! Quick heads-up: your Acme trial wraps up this week.',
            position: { x: 320, y: 640 },
          },
          {
            id: 'in_app',
            type: 'send_in_app',
            messageId: inAppUpgrade.id,
            position: { x: 40, y: 800 },
          },
          { id: 'done', type: 'end', position: { x: 40, y: 960 } },
        ],
        edges: [
          { from: 'heads_up', to: 'soak' },
          { from: 'soak', to: 'split' },
          { from: 'split', to: 'nudge_sms', label: 'a' },
          { from: 'split', to: 'nudge_wa', label: 'b' },
          { from: 'nudge_sms', to: 'in_app' },
          { from: 'nudge_wa', to: 'in_app' },
          { from: 'in_app', to: 'done' },
        ],
      }),
    },
  });

  // A draft the operator can finish: branch + webhook handoff.
  await prisma.journey.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Win-back inactive users' } },
    update: {},
    create: {
      id: newId('jny'),
      ...ws,
      name: 'Win-back inactive users',
      status: 'DRAFT',
      definition: json(journeyDefinitionSchema, {
        trigger: { type: 'event', event: 'Became Inactive' },
        startNodeId: 'miss_you',
        nodes: [
          {
            id: 'miss_you',
            type: 'send_email',
            templateId: winBack.id,
            position: { x: 40, y: 160 },
          },
          { id: 'soak', type: 'wait', seconds: 3 * 86_400, position: { x: 40, y: 320 } },
          {
            id: 'still_free',
            type: 'branch',
            condition: {
              kind: 'condition',
              target: 'attribute',
              key: 'plan',
              operator: 'equals',
              value: 'free',
            },
            position: { x: 40, y: 480 },
          },
          {
            id: 'crm_handoff',
            type: 'webhook',
            url: 'https://example.com/hooks/sales-handoff',
            position: { x: -240, y: 640 },
          },
          { id: 'done', type: 'end', position: { x: 40, y: 800 } },
        ],
        edges: [
          { from: 'miss_you', to: 'soak' },
          { from: 'soak', to: 'still_free' },
          { from: 'still_free', to: 'crm_handoff', label: 'yes' },
          { from: 'still_free', to: 'done', label: 'no' },
          { from: 'crm_handoff', to: 'done' },
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
      where: { workspaceId_event: { workspaceId: ws.workspaceId, event: rule.event } },
      update: {},
      create: { id: newId('score'), ...ws, event: rule.event, points: rule.points },
    });
  }

  // ── Hosted signup forms ──────────────────────────────────────────────
  await prisma.form.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Newsletter' } },
    update: {},
    create: { id: newId('form'), ...ws, name: 'Newsletter', title: 'Join the Acme newsletter' },
  });
  await prisma.form.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Beta waitlist' } },
    update: {},
    create: { id: newId('form'), ...ws, name: 'Beta waitlist', title: 'Get early access to Acme' },
  });

  // ── Landing page, on-site widget, and a booking page ─────────────────
  await prisma.landingPage.upsert({
    where: { id: `lp_${idPrefix}_launch` },
    update: {},
    create: {
      id: `lp_${idPrefix}_launch`,
      ...ws,
      title: 'Fall launch',
      published: true,
      blocks: json(landingDocumentSchema, [
        { type: 'heading', text: 'Acme ships its biggest release yet' },
        {
          type: 'text',
          text: 'Faster automations, a smarter copilot, and every channel in one place. Be first in line when it lands.',
        },
        { type: 'form', buttonLabel: 'Save my spot' },
        { type: 'button', label: 'Read the announcement', href: 'https://example.com/blog' },
      ]),
    },
  });

  await prisma.widget.upsert({
    where: { id: `wdg_${idPrefix}_launch` },
    update: {},
    create: {
      id: `wdg_${idPrefix}_launch`,
      ...ws,
      name: 'Fall launch banner',
      type: 'BANNER',
      title: 'The fall release is here',
      body: 'New journeys, new channels, same price.',
      ctaLabel: 'See what changed',
      ctaUrl: 'https://example.com/changelog',
      active: true,
    },
  });

  const bookingPage = await prisma.bookingPage.upsert({
    where: { id: `bpg_${idPrefix}_intro` },
    update: {},
    create: {
      id: `bpg_${idPrefix}_intro`,
      ...ws,
      title: 'Intro call',
      description: 'Thirty minutes with the Acme team — bring your questions.',
      durationMinutes: 30,
      timezone: 'Europe/Paris',
      availability: availabilitySchema.parse(DEFAULT_AVAILABILITY) as Prisma.InputJsonValue,
      bufferMinutes: 0,
      enabled: true,
    },
  });
  // Two upcoming meetings, pinned to weekday mornings so they are always
  // in the future and never collide with the unique (page, startAt).
  const nextWeekday = (from: Date, daysAhead: number, utcHour: number): Date => {
    const date = new Date(from);
    date.setUTCDate(date.getUTCDate() + daysAhead);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    date.setUTCHours(utcHour, 30, 0, 0);
    return date;
  };
  // Distinct hours: weekend seeds advance both meetings to the same Monday,
  // and the unique (page, startAt) must still hold.
  const invitees = [
    { n: 1, daysAhead: 1, utcHour: 8, email: 'sofia@datapipe.example', name: 'Sofia Marquez' },
    { n: 2, daysAhead: 2, utcHour: 10, email: 'james@cloudnine.example', name: 'James Wu' },
  ];
  for (const invitee of invitees) {
    const id = `mtg_${idPrefix}_${invitee.n}`;
    const startAt = nextWeekday(predictedAt, invitee.daysAhead, invitee.utcHour);
    await prisma.meeting.upsert({
      where: { id },
      update: { startAt },
      create: {
        id,
        ...ws,
        bookingPageId: bookingPage.id,
        startAt,
        durationMinutes: 30,
        inviteeEmail: invitee.email,
        inviteeName: invitee.name,
        status: 'BOOKED',
      },
    });
  }

  // ── CRM: a default pipeline with stages and a few open/won deals ─────
  const pipeline = await prisma.pipeline.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'New business' } },
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
    const id = `stg_${idPrefix}_${stage.key}`;
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
    const id = `deal_${idPrefix}_${deal.n}`;
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
    const id = `task_${idPrefix}_${task.n}`;
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
        dealId: task.deal ? `deal_${idPrefix}_${task.deal}` : null,
      },
    });
  }

  // Deterministic demo write key: local-only, lets the quickstart and the
  // SDK snippet work immediately after `task up`. Never reuse in prod.
  const writeKey = await prisma.writeKey.upsert({
    where: { key: writeKeyValue },
    update: {},
    create: {
      id: newId('wkey'),
      ...ws,
      key: writeKeyValue,
      name: 'Demo browser source',
    },
  });

  await prisma.auditLog.create({
    data: {
      id: newId('audit'),
      ...ws,
      action: 'workspace.seeded',
      targetType: 'workspace',
      targetId: ws.workspaceId,
      metadata: { source: 'prisma/seed.ts' },
    },
  });

  return {
    contacts: contacts.length,
    segments: segments.length,
    templates: 4,
    campaigns: 2,
    sends: sendable.length,
    journeys: 3,
    scoringRules: scoringRules.length,
    forms: 2,
    meetings: invitees.length,
    pipelineName: pipeline.name,
    stages: stageDefs.length,
    deals: deals.length,
    tasks: demoTasks.length,
    writeKey: writeKey.key,
  };
}
