import RedisMock from 'ioredis-mock';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import {
  applyEmailSuppression,
  postmarkSuppression,
  sesSuppression,
} from '../src/routes/email-webhook';
import type { GatewayDeps, RedisLike } from '../src/types';

const TOKEN = 'whk_email_test_token';

/** A Prisma stub: the resolver lookup plus contact/audit writes. */
function fakePrisma(contacts: Array<{ id: string; organizationId: string; workspaceId: string }>) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const prisma: Record<string, unknown> = {
    // webhook_contacts_by_email runs as raw SQL (ADR-0017).
    $queryRaw: vi.fn().mockResolvedValue(contacts),
    contact: {
      update: vi.fn(async (args: (typeof updates)[number]) => {
        updates.push(args);
        return {};
      }),
    },
    auditLog: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return {};
      }),
    },
  };
  // forTenant() extends the client; the stub hands back itself.
  prisma.$extends = () => prisma;
  return { prisma: prisma as never, updates, audits };
}

describe('postmarkSuppression', () => {
  it('suppresses a hard bounce', () => {
    expect(
      postmarkSuppression({ RecordType: 'Bounce', Type: 'HardBounce', Email: 'a@x.com' }),
    ).toEqual({ reason: 'BOUNCED', emails: ['a@x.com'], detail: 'HardBounce' });
  });

  it('suppresses a bad address and a spam complaint', () => {
    expect(
      postmarkSuppression({ RecordType: 'Bounce', Type: 'BadEmailAddress', Email: 'a@x.com' })
        ?.reason,
    ).toBe('BOUNCED');
    expect(postmarkSuppression({ RecordType: 'SpamComplaint', Email: 'a@x.com' })).toEqual({
      reason: 'COMPLAINED',
      emails: ['a@x.com'],
      detail: 'SpamComplaint',
    });
  });

  it('ignores transient bounces, other records, and missing addresses', () => {
    expect(
      postmarkSuppression({ RecordType: 'Bounce', Type: 'SoftBounce', Email: 'a@x.com' }),
    ).toBeNull();
    expect(
      postmarkSuppression({ RecordType: 'Bounce', Type: 'Transient', Email: 'a@x.com' }),
    ).toBeNull();
    expect(postmarkSuppression({ RecordType: 'Open', Email: 'a@x.com' })).toBeNull();
    expect(postmarkSuppression({ RecordType: 'Bounce', Type: 'HardBounce' })).toBeNull();
  });
});

describe('sesSuppression', () => {
  it('suppresses every recipient of a permanent bounce', () => {
    expect(
      sesSuppression({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'a@x.com' }, { emailAddress: 'b@x.com' }],
        },
      }),
    ).toEqual({ reason: 'BOUNCED', emails: ['a@x.com', 'b@x.com'], detail: 'Permanent' });
  });

  it('ignores transient bounces and deliveries', () => {
    expect(
      sesSuppression({
        notificationType: 'Bounce',
        bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'a@x.com' }] },
      }),
    ).toBeNull();
    expect(sesSuppression({ notificationType: 'Delivery' })).toBeNull();
  });

  it('suppresses complaints with the feedback type as detail', () => {
    expect(
      sesSuppression({
        notificationType: 'Complaint',
        complaint: {
          complainedRecipients: [{ emailAddress: 'a@x.com' }],
          complaintFeedbackType: 'abuse',
        },
      }),
    ).toEqual({ reason: 'COMPLAINED', emails: ['a@x.com'], detail: 'abuse' });
  });
});

describe('applyEmailSuppression', () => {
  it('flips every matched contact and audit-logs each, per tenant', async () => {
    const { prisma, updates, audits } = fakePrisma([
      { id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' },
      { id: 'c2', organizationId: 'org_2', workspaceId: 'ws_2' },
    ]);
    const result = await applyEmailSuppression(
      prisma,
      { reason: 'BOUNCED', emails: ['Bad@X.com'], detail: 'HardBounce' },
      'postmark',
    );
    expect(result.suppressed).toBe(2);
    expect(updates.map((u) => u.data.status)).toEqual(['BOUNCED', 'BOUNCED']);
    expect(audits[0]).toMatchObject({
      action: 'contact.bounced',
      organizationId: 'org_1',
      workspaceId: 'ws_1',
      metadata: { via: 'email_webhook', provider: 'postmark', detail: 'HardBounce' },
    });
    expect(audits[1]).toMatchObject({ organizationId: 'org_2' });
  });

  it('records complaints under their own audit action', async () => {
    const { prisma, audits } = fakePrisma([
      { id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' },
    ]);
    await applyEmailSuppression(
      prisma,
      { reason: 'COMPLAINED', emails: ['a@x.com'], detail: 'abuse' },
      'ses',
    );
    expect(audits[0]!.action).toBe('contact.complained');
  });
});

describe('POST /webhooks/email/:provider', () => {
  function makeApp(
    contacts: Array<{ id: string; organizationId: string; workspaceId: string }> = [],
    emailWebhook?: GatewayDeps['emailWebhook'],
  ) {
    const fakes = fakePrisma(contacts);
    const app = createApp({
      prisma: fakes.prisma,
      redis: new RedisMock() as unknown as RedisLike,
      rateLimit: { max: 1000, windowSeconds: 3600 },
      emailWebhook,
    });
    return { app, ...fakes };
  }

  const config = (fetcher = vi.fn().mockResolvedValue(undefined)) => ({
    token: TOKEN,
    fetch: fetcher,
  });

  it('404s when not configured', async () => {
    const { app } = makeApp();
    const response = await app.request('/webhooks/email/postmark?token=x', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(404);
  });

  it('401s on a wrong token and 404s on an unknown provider', async () => {
    const { app } = makeApp([], config());
    const bad = await app.request('/webhooks/email/postmark?token=wrong', {
      method: 'POST',
      body: '{}',
    });
    expect(bad.status).toBe(401);
    const unknown = await app.request(`/webhooks/email/sendgrid?token=${TOKEN}`, {
      method: 'POST',
      body: '{}',
    });
    expect(unknown.status).toBe(404);
  });

  it('suppresses on a Postmark hard bounce', async () => {
    const { app, updates } = makeApp(
      [{ id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' }],
      config(),
    );
    const response = await app.request(`/webhooks/email/postmark?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ RecordType: 'Bounce', Type: 'HardBounce', Email: 'a@x.com' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, suppressed: 1 });
    expect(updates).toHaveLength(1);
  });

  it('acknowledges but does not suppress a soft bounce', async () => {
    const { app, updates } = makeApp(
      [{ id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' }],
      config(),
    );
    const response = await app.request(`/webhooks/email/postmark?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ RecordType: 'Bounce', Type: 'SoftBounce', Email: 'a@x.com' }),
    });
    expect(await response.json()).toEqual({ received: true, suppressed: 0 });
    expect(updates).toHaveLength(0);
  });

  it('confirms an SNS subscription only on a real AWS https URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined);
    const { app } = makeApp([], config(fetcher));
    const ok = await app.request(`/webhooks/email/ses?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=t',
      }),
    });
    expect(ok.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // A forged envelope pointing anywhere else is refused — no SSRF.
    const evil = await app.request(`/webhooks/email/ses?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://attacker.example.com/steal',
      }),
    });
    expect(evil.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('unwraps a stringified SNS Message and suppresses its recipients', async () => {
    const { app, updates } = makeApp(
      [{ id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' }],
      config(),
    );
    const response = await app.request(`/webhooks/email/ses?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({
          notificationType: 'Complaint',
          complaint: { complainedRecipients: [{ emailAddress: 'a@x.com' }] },
        }),
      }),
    });
    expect(await response.json()).toEqual({ received: true, suppressed: 1 });
    expect(updates[0]!.data.status).toBe('COMPLAINED');
  });
});
