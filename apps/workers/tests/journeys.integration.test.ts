import { execSync } from 'node:child_process';
import path from 'node:path';

import { type EnrichedEvent, newId } from '@helio/core';
import { createPrismaClient, type PrismaClient } from '@helio/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { InMemoryEmailProvider } from '../src/email-provider';
import { createJourneyActivities, type JourneyActivities } from '../src/journey-activities';
import { enrollFromEvent, scoreFromEvent } from '../src/journey-triggers';

const CONFIG = {
  mailFrom: 'Helio <no-reply@helio.test>',
  appUrl: 'http://app.helio.test',
  trackingUrl: 'http://t.helio.test',
  trackingSecret: 'tracking-secret-for-tests-0001',
  unsubscribeSecret: 'unsubscribe-secret-for-tests-1',
  webhookSecret: 'webhook-secret-for-tests-000001',
};

describe('journey activities + trigger enrollment against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let provider: InMemoryEmailProvider;
  let activities: JourneyActivities;

  const orgId = newId('org');
  const wsId = newId('ws');
  const templateId = newId('tpl');
  const journeyId = newId('jny');
  let adaId: string;
  let goneId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_journeys_test')
      .start();
    const adminUrl = container.getConnectionUri();
    execSync('pnpm --filter @helio/db exec prisma migrate deploy', {
      cwd: path.resolve(import.meta.dirname, '../../..'),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
      stdio: 'pipe',
    });
    prisma = createPrismaClient(adminUrl);
    provider = new InMemoryEmailProvider();
    activities = createJourneyActivities(prisma, provider, CONFIG);

    await prisma.organization.create({ data: { id: orgId, name: 'J', slug: 'journeys' } });
    await prisma.workspace.create({
      data: { id: wsId, organizationId: orgId, name: 'J', slug: 'main' },
    });
    await prisma.emailTemplate.create({
      data: {
        id: templateId,
        organizationId: orgId,
        workspaceId: wsId,
        name: 'Welcome',
        subject: 'Welcome {{firstName|aboard}}',
        document: { blocks: [{ id: 'b1', type: 'paragraph', text: 'Hi {{firstName|there}}!' }] },
      },
    });
    adaId = newId('contact');
    goneId = newId('contact');
    await prisma.contact.createMany({
      data: [
        {
          id: adaId,
          organizationId: orgId,
          workspaceId: wsId,
          email: 'ada@example.com',
          firstName: 'Ada',
          attributes: { plan: 'pro' },
        },
        {
          id: goneId,
          organizationId: orgId,
          workspaceId: wsId,
          email: 'gone@example.com',
          status: 'UNSUBSCRIBED',
          attributes: {},
        },
      ],
    });
    await prisma.journey.create({
      data: {
        id: journeyId,
        organizationId: orgId,
        workspaceId: wsId,
        name: 'Onboarding',
        status: 'ACTIVE',
        definition: {
          trigger: { type: 'event', event: 'Signed Up' },
          startNodeId: 'n1',
          nodes: [{ id: 'n1', type: 'end' }],
          edges: [],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('loadJourney returns the stored definition with tenancy', async () => {
    const loaded = await activities.loadJourney(journeyId);
    expect(loaded.organizationId).toBe(orgId);
    expect(loaded.workspaceId).toBe(wsId);
    expect((loaded.definition as { startNodeId: string }).startNodeId).toBe('n1');
  });

  it('sendJourneyEmail records FAILED and rethrows when delivery fails', async () => {
    provider.failFor.add('ada@example.com');
    await expect(activities.sendJourneyEmail(journeyId, adaId, templateId)).rejects.toThrowError(
      /delivery refused/,
    );
    provider.failFor.clear();
    const failed = await prisma.emailSend.findFirst({
      where: { contactId: adaId, status: 'FAILED' },
    });
    expect(failed?.error).toContain('delivery refused');
    await prisma.emailSend.deleteMany({ where: { contactId: adaId } });
  });

  it('sendJourneyEmail renders, tracks, and records the send', async () => {
    const result = await activities.sendJourneyEmail(journeyId, adaId, templateId);
    expect(result).toEqual({ sent: true });
    const mail = provider.sent.at(-1)!;
    expect(mail.to).toBe('ada@example.com');
    expect(mail.subject).toBe('Welcome Ada');
    expect(mail.html).toContain('Hi Ada!');
    expect(mail.html).toMatch(/http:\/\/t\.helio\.test\/o\/snd_[a-z0-9]+\.gif/);

    const sends = await prisma.emailSend.findMany({ where: { contactId: adaId } });
    expect(sends).toHaveLength(1);
    expect(sends[0]!.status).toBe('SENT');
    expect(sends[0]!.campaignId).toBeNull();
  });

  it('sendJourneyEmail skips suppressed contacts without a send row', async () => {
    const result = await activities.sendJourneyEmail(journeyId, goneId, templateId);
    expect(result).toEqual({ sent: false });
    expect(await prisma.emailSend.count({ where: { contactId: goneId } })).toBe(0);
  });

  it('evaluateCondition answers against live contact data', async () => {
    const condition = {
      kind: 'condition',
      target: 'attribute',
      key: 'plan',
      operator: 'equals',
      value: 'pro',
    } as const;
    expect(await activities.evaluateCondition(adaId, condition)).toBe(true);
    expect(await activities.evaluateCondition(goneId, condition)).toBe(false);
  });

  it('run bookkeeping: complete and fail', async () => {
    const run = await prisma.journeyRun.create({
      data: { id: newId('run'), organizationId: orgId, journeyId, contactId: adaId },
    });
    await activities.completeRun(run.id);
    expect((await prisma.journeyRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      'COMPLETED',
    );
    await activities.failRun(run.id, 'boom');
    const failed = await prisma.journeyRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('boom');
    await prisma.journeyRun.delete({ where: { id: run.id } });
  });

  describe('scoreFromEvent', () => {
    it('applies matching rules atomically, including negatives', async () => {
      await prisma.scoringRule.createMany({
        data: [
          {
            id: newId('score'),
            organizationId: orgId,
            workspaceId: wsId,
            event: 'Demo Booked',
            points: 25,
          },
          {
            id: newId('score'),
            organizationId: orgId,
            workspaceId: wsId,
            event: 'Churn Risk',
            points: -10,
          },
        ],
      });
      const deps = { prisma, temporal: {} as never, logger: pino({ level: 'silent' }) };
      const base = {
        message_id: newId('msg'),
        organization_id: orgId,
        workspace_id: wsId,
        type: 'track' as const,
        anonymous_id: '',
        user_id: 'ada@example.com',
        properties: '{}',
        context: '{}',
        timestamp: new Date().toISOString(),
        received_at: new Date().toISOString(),
      };

      expect(await scoreFromEvent({ ...base, event: 'Demo Booked' }, deps)).toBe(true);
      expect(await scoreFromEvent({ ...base, event: 'Demo Booked' }, deps)).toBe(true);
      expect(await scoreFromEvent({ ...base, event: 'Churn Risk' }, deps)).toBe(true);
      expect(await scoreFromEvent({ ...base, event: 'Unscored Event' }, deps)).toBe(false);
      expect(
        await scoreFromEvent({ ...base, event: 'Demo Booked', user_id: 'ghost@x.com' }, deps),
      ).toBe(false);

      const ada = await prisma.contact.findUniqueOrThrow({
        where: { workspaceId_email: { workspaceId: wsId, email: 'ada@example.com' } },
      });
      expect(ada.score).toBe(25 + 25 - 10);
    });
  });

  describe('enrollFromEvent', () => {
    function makeEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
      return {
        message_id: newId('msg'),
        organization_id: orgId,
        workspace_id: wsId,
        type: 'track',
        event: 'Signed Up',
        anonymous_id: '',
        user_id: 'ada@example.com',
        properties: '{}',
        context: '{}',
        timestamp: new Date().toISOString(),
        received_at: new Date().toISOString(),
        ...overrides,
      };
    }

    function makeTemporal() {
      const start = vi.fn(async () => ({}) as never);
      return { client: { workflow: { start } } as never, start };
    }

    it('starts one run per matching journey and guards re-entry', async () => {
      const { client, start } = makeTemporal();
      const deps = { prisma, temporal: client, logger: pino({ level: 'silent' }) };

      expect(await enrollFromEvent(makeEvent(), deps)).toBe(1);
      expect(start).toHaveBeenCalledTimes(1);
      const runs = await prisma.journeyRun.findMany({ where: { journeyId } });
      expect(runs).toHaveLength(1);
      expect(runs[0]!.status).toBe('RUNNING');

      // Same contact again while RUNNING → no second enrollment.
      expect(await enrollFromEvent(makeEvent(), deps)).toBe(0);
      expect(start).toHaveBeenCalledTimes(1);
    });

    it('ignores other events, unknown users, suppressed contacts, and inactive journeys', async () => {
      const { client, start } = makeTemporal();
      const deps = { prisma, temporal: client, logger: pino({ level: 'silent' }) };

      expect(await enrollFromEvent(makeEvent({ event: 'Page Viewed' }), deps)).toBe(0);
      expect(await enrollFromEvent(makeEvent({ user_id: 'nobody@example.com' }), deps)).toBe(0);
      expect(await enrollFromEvent(makeEvent({ user_id: 'gone@example.com' }), deps)).toBe(0);
      expect(await enrollFromEvent(makeEvent({ type: 'identify' }), deps)).toBe(0);

      await prisma.journey.update({ where: { id: journeyId }, data: { status: 'PAUSED' } });
      expect(await enrollFromEvent(makeEvent({ user_id: 'ada@example.com' }), deps)).toBe(0);
      await prisma.journey.update({ where: { id: journeyId }, data: { status: 'ACTIVE' } });

      expect(start).not.toHaveBeenCalled();
    });

    it('marks the run failed when the workflow cannot start', async () => {
      // Clear the RUNNING guard from the earlier test.
      await prisma.journeyRun.updateMany({
        where: { journeyId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const start = vi.fn(async () => {
        throw new Error('temporal down');
      });
      const deps = {
        prisma,
        temporal: { workflow: { start } } as never,
        logger: pino({ level: 'silent' }),
      };
      expect(await enrollFromEvent(makeEvent(), deps)).toBe(0);
      const failed = await prisma.journeyRun.findFirst({
        where: { journeyId, status: 'FAILED' },
      });
      expect(failed?.error).toBe('failed to start workflow');
    });
  });

  describe('v2 activities', () => {
    it('sendGate: caps on recent sends, defers in quiet hours, 0 otherwise', async () => {
      // ada has 1 SENT mail from earlier tests; cap of 1 per week trips.
      expect(await activities.sendGate(adaId, null, { maxEmails: 1, perDays: 7 })).toBe(-1);
      expect(await activities.sendGate(adaId, null, { maxEmails: 10, perDays: 7 })).toBe(0);

      const always = { start: '00:00', end: '23:59', timezone: 'UTC' };
      expect(await activities.sendGate(adaId, always, null)).toBeGreaterThan(0);
      expect(await activities.sendGate(adaId, null, null)).toBe(0);
    });

    it('applyTrait merges into attributes and tolerates unknown contacts', async () => {
      await activities.applyTrait(adaId, 'variant', 'a');
      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: adaId } });
      expect(contact.attributes).toMatchObject({ plan: 'pro', variant: 'a' });
      await expect(activities.applyTrait('contact_ghost', 'x', 'y')).resolves.toBeUndefined();
    });

    it('callWebhook signs the payload and throws on non-2xx', async () => {
      const { createServer } = await import('node:http');
      const { createHmac } = await import('node:crypto');
      const received: Array<{ signature: string | undefined; body: string }> = [];
      let respondWith = 200;
      const server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk: Buffer) => (body += chunk.toString()));
        request.on('end', () => {
          received.push({ signature: request.headers['x-helio-signature'] as string, body });
          response.statusCode = respondWith;
          response.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}/hook`;

      try {
        await activities.callWebhook(url, { journeyId: 'j', contactId: 'c', email: 'a@x.com' });
        expect(received).toHaveLength(1);
        const expected = createHmac('sha256', 'webhook-secret-for-tests-000001')
          .update(received[0]!.body)
          .digest('hex');
        expect(received[0]!.signature).toBe(expected);
        expect(JSON.parse(received[0]!.body)).toMatchObject({ journeyId: 'j', email: 'a@x.com' });

        respondWith = 503;
        await expect(
          activities.callWebhook(url, { journeyId: 'j', contactId: 'c', email: 'a@x.com' }),
        ).rejects.toThrowError(/503/);
      } finally {
        server.close();
      }
    });

    it('contactEmail resolves and falls back to empty', async () => {
      expect(await activities.contactEmail(adaId)).toBe('ada@example.com');
      expect(await activities.contactEmail('contact_ghost')).toBe('');
    });
  });
});
