import { execSync } from 'node:child_process';
import path from 'node:path';

import { newId } from '@helio/core';
import { createPrismaClient, type PrismaClient } from '@helio/db';
import { MockActivityEnvironment } from '@temporalio/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CampaignActivities, createActivities } from '../src/activities';
import { InMemoryEmailProvider } from '../src/email-provider';

const CONFIG = {
  mailFrom: 'Helio <no-reply@helio.test>',
  appUrl: 'http://app.helio.test',
  trackingUrl: 'http://t.helio.test',
  trackingSecret: 'tracking-secret-for-tests-0001',
  unsubscribeSecret: 'unsubscribe-secret-for-tests-1',
};

describe('campaign activities against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let provider: InMemoryEmailProvider;
  let activities: CampaignActivities;
  const activityEnv = new MockActivityEnvironment();

  const orgId = newId('org');
  const wsId = newId('ws');
  const templateId = newId('tpl');
  const segmentId = newId('seg');
  const listId = newId('list');
  let campaignId: string;
  const contactIds: string[] = [];

  function runActivity<T>(fn: (...args: never[]) => Promise<T>, ...args: unknown[]): Promise<T> {
    return activityEnv.run(fn as never, ...(args as never[])) as Promise<T>;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_workers_test')
      .start();
    const adminUrl = container.getConnectionUri();
    execSync('pnpm --filter @helio/db exec prisma migrate deploy', {
      cwd: path.resolve(import.meta.dirname, '../../..'),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
      stdio: 'pipe',
    });
    prisma = createPrismaClient(adminUrl);
    provider = new InMemoryEmailProvider();
    activities = createActivities(prisma, provider, CONFIG);

    await prisma.organization.create({ data: { id: orgId, name: 'W', slug: 'workers' } });
    await prisma.workspace.create({
      data: { id: wsId, organizationId: orgId, name: 'W', slug: 'main' },
    });
    await prisma.emailTemplate.create({
      data: {
        id: templateId,
        organizationId: orgId,
        workspaceId: wsId,
        name: 'Welcome',
        subject: 'Hi {{firstName|there}}',
        document: {
          blocks: [
            { id: 'b1', type: 'heading', text: 'Hello {{firstName|there}}' },
            { id: 'b2', type: 'button', label: 'Go', url: 'https://example.com/landing' },
          ],
        },
      },
    });
    await prisma.segment.create({
      data: {
        id: segmentId,
        organizationId: orgId,
        workspaceId: wsId,
        name: 'Pro',
        rule: {
          kind: 'group',
          op: 'and',
          children: [
            {
              kind: 'condition',
              target: 'attribute',
              key: 'plan',
              operator: 'equals',
              value: 'pro',
            },
          ],
        },
      },
    });
    await prisma.contactList.create({
      data: { id: listId, organizationId: orgId, workspaceId: wsId, name: 'Everyone' },
    });

    const seed = [
      { email: 'ada@example.com', firstName: 'Ada', attributes: { plan: 'pro' }, status: 'ACTIVE' },
      {
        email: 'grace@example.com',
        firstName: 'Grace',
        attributes: { plan: 'pro' },
        status: 'ACTIVE',
      },
      {
        email: 'fail@example.com',
        firstName: 'Flaky',
        attributes: { plan: 'pro' },
        status: 'ACTIVE',
      },
      {
        email: 'gone@example.com',
        firstName: 'Gone',
        attributes: { plan: 'pro' },
        status: 'UNSUBSCRIBED',
      },
      {
        email: 'free@example.com',
        firstName: 'Free',
        attributes: { plan: 'free' },
        status: 'ACTIVE',
      },
    ] as const;
    for (const row of seed) {
      const id = newId('contact');
      contactIds.push(id);
      await prisma.contact.create({
        data: { id, organizationId: orgId, workspaceId: wsId, ...row },
      });
      await prisma.contactListMember.create({
        data: { listId, contactId: id, organizationId: orgId },
      });
    }

    campaignId = newId('cmp');
    await prisma.campaign.create({
      data: {
        id: campaignId,
        organizationId: orgId,
        workspaceId: wsId,
        name: 'Launch',
        templateId,
        segmentId,
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('startCampaign transitions to SENDING', async () => {
    const context = await runActivity(activities.startCampaign, campaignId);
    expect(context).toEqual({ organizationId: orgId, workspaceId: wsId });
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe('SENDING');
  });

  it('listRecipients applies the segment, suppression, and pagination', async () => {
    const first = await runActivity(activities.listRecipients, campaignId, null, 2);
    expect(first.contactIds).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await runActivity(activities.listRecipients, campaignId, first.nextCursor, 2);
    expect(second.nextCursor).toBeNull();

    const all = [...first.contactIds, ...second.contactIds];
    const emails = await prisma.contact.findMany({
      where: { id: { in: all } },
      select: { email: true },
    });
    const set = new Set(emails.map((row) => row.email));
    // pro-plan ACTIVE contacts only: no unsubscribed, no free plan.
    expect(set).toEqual(new Set(['ada@example.com', 'grace@example.com', 'fail@example.com']));
  });

  it('sendToContacts renders tracked, personalized mail and records sends', async () => {
    provider.failFor.add('fail@example.com');
    const page = await runActivity(activities.listRecipients, campaignId, null, 100);
    const result = await runActivity(activities.sendToContacts, campaignId, page.contactIds);
    expect(result).toEqual({ sent: 2, failed: 1, skipped: 0 });

    const ada = provider.sent.find((message) => message.to === 'ada@example.com')!;
    expect(ada.subject).toBe('Hi Ada');
    expect(ada.html).toContain('Hello Ada');
    // Button wrapped through the click redirector, signed per send
    // (& is entity-escaped inside HTML attributes).
    expect(ada.html).toMatch(
      /http:\/\/t\.helio\.test\/c\/snd_[a-z0-9]+\?u=https%3A%2F%2Fexample\.com%2Flanding&amp;s=/,
    );
    // Open pixel and unsubscribe link present.
    expect(ada.html).toMatch(/http:\/\/t\.helio\.test\/o\/snd_[a-z0-9]+\.gif/);
    expect(ada.html).toContain('http://app.helio.test/u/contact_');
    expect(ada.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const sends = await prisma.emailSend.findMany({ where: { campaignId } });
    expect(sends).toHaveLength(3);
    expect(sends.filter((send) => send.status === 'SENT')).toHaveLength(2);
    const failed = sends.find((send) => send.status === 'FAILED');
    expect(failed?.email).toBe('fail@example.com');
    expect(failed?.error).toContain('delivery refused');
  });

  it('retries are idempotent: SENT skipped, FAILED retried without duplicates', async () => {
    provider.failFor.clear();
    const before = provider.sent.length;
    const page = await runActivity(activities.listRecipients, campaignId, null, 100);
    const result = await runActivity(activities.sendToContacts, campaignId, page.contactIds);
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 2 });
    expect(provider.sent.length).toBe(before + 1); // only the recovered failure
    expect(provider.sent.at(-1)!.to).toBe('fail@example.com');

    const sends = await prisma.emailSend.findMany({ where: { campaignId } });
    expect(sends).toHaveLength(3); // no duplicate rows
    expect(sends.every((send) => send.status === 'SENT')).toBe(true);
  });

  it('completeCampaign and failCampaign set terminal states', async () => {
    await runActivity(activities.completeCampaign, campaignId, 0);
    let campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe('SENT');
    expect(campaign.sentAt).not.toBeNull();

    await runActivity(activities.failCampaign, campaignId, 'boom');
    campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe('FAILED');
    expect(campaign.error).toBe('boom');
  });

  it('list audiences work too', async () => {
    const listCampaignId = newId('cmp');
    await prisma.campaign.create({
      data: {
        id: listCampaignId,
        organizationId: orgId,
        workspaceId: wsId,
        name: 'List blast',
        templateId,
        listId,
      },
    });
    const page = await runActivity(activities.listRecipients, listCampaignId, null, 100);
    // 4 ACTIVE members of the list (unsubscribed excluded).
    expect(page.contactIds).toHaveLength(4);
  });
});
