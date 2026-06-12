import RedisMock from 'ioredis-mock';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import type { GatewayDeps, RedisLike } from '../src/types';

/**
 * Twilio delivery-status callback: token-gated, raises one deduped
 * operational alert per org holding the failed number, and ignores
 * everything that delivered fine.
 */
function fakePrisma(options: {
  contacts?: Array<{ id: string; organizationId: string; workspaceId: string }>;
  existingAlert?: boolean;
}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma: Record<string, unknown> = {
    $queryRaw: vi.fn().mockResolvedValue(options.contacts ?? []),
    systemAlert: {
      findFirst: vi.fn().mockResolvedValue(options.existingAlert ? { id: 'alert_1' } : null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      }),
    },
  };
  prisma.$extends = () => prisma;
  return { prisma: prisma as never, created };
}

function makeApp(deps: Partial<GatewayDeps>, prisma: never) {
  return createApp({
    prisma,
    redis: new RedisMock() as unknown as RedisLike,
    rateLimit: { max: 1000, windowSeconds: 3600 },
    ...deps,
  });
}

const post = (
  app: ReturnType<typeof createApp>,
  body: Record<string, string>,
  token = 'sms-secret',
) =>
  app.request(`/webhooks/sms/twilio?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

describe('POST /webhooks/sms/twilio', () => {
  const failedBody = {
    MessageStatus: 'undelivered',
    MessageSid: 'SM123',
    To: '+15555550101',
    ErrorCode: '30003',
  };

  it('404s until configured and 401s on a bad token', async () => {
    const { prisma } = fakePrisma({});
    expect((await post(makeApp({}, prisma), failedBody)).status).toBe(404);
    const app = makeApp({ smsWebhook: { token: 'sms-secret' } }, prisma);
    expect((await post(app, failedBody, 'wrong')).status).toBe(401);
  });

  it('ignores delivered statuses', async () => {
    const { prisma, created } = fakePrisma({
      contacts: [{ id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' }],
    });
    const app = makeApp({ smsWebhook: { token: 'sms-secret' } }, prisma);
    const response = await post(app, { ...failedBody, MessageStatus: 'delivered' });
    expect(response.status).toBe(204);
    expect(created).toHaveLength(0);
  });

  it('raises one alert per organization holding the number', async () => {
    const { prisma, created } = fakePrisma({
      contacts: [
        { id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' },
        { id: 'c2', organizationId: 'org_1', workspaceId: 'ws_2' },
        { id: 'c3', organizationId: 'org_2', workspaceId: 'ws_3' },
      ],
    });
    const app = makeApp({ smsWebhook: { token: 'sms-secret' } }, prisma);
    const response = await post(app, failedBody);
    expect(response.status).toBe(204);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      kind: 'sms_delivery_failed',
      organizationId: 'org_1',
      context: { messageSid: 'SM123', errorCode: '30003' },
    });
    expect(String(created[0]!.message)).toContain('Twilio error 30003');
  });

  it('dedupes against an unread alert for the same message', async () => {
    const { prisma, created } = fakePrisma({
      contacts: [{ id: 'c1', organizationId: 'org_1', workspaceId: 'ws_1' }],
      existingAlert: true,
    });
    const app = makeApp({ smsWebhook: { token: 'sms-secret' } }, prisma);
    expect((await post(app, failedBody)).status).toBe(204);
    expect(created).toHaveLength(0);
  });
});
