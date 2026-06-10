import { createHmac } from 'node:crypto';

import RedisMock from 'ioredis-mock';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { handleShopifyWebhook } from '../src/routes/shopify-webhook';
import type { RedisLike } from '../src/types';

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64');

const connection = { organizationId: 'org_1', workspaceId: 'ws_1' };

interface FakeOpts {
  integration?: { organizationId: string; workspaceId: string; secret: string } | null;
  existingContact?: {
    id: string;
    attributes: Record<string, unknown>;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

function fakePrisma(opts: FakeOpts = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ data: Record<string, unknown> }> = [];
  const prisma: Record<string, unknown> = {
    // The shop→connection lookup runs through the SECURITY DEFINER webhook
    // resolver, i.e. raw SQL (ADR-0017).
    $queryRaw: vi.fn().mockResolvedValue(opts.integration ? [opts.integration] : []),
    contact: {
      findUnique: vi.fn().mockResolvedValue(opts.existingContact ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: args.data.id };
      }),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        updated.push(args);
        return {};
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  // forTenant() extends the client; the stub hands back itself.
  prisma.$extends = () => prisma;
  return { prisma: prisma as never, created, updated };
}

describe('handleShopifyWebhook', () => {
  it('creates a contact from a customers/create payload', async () => {
    const { prisma, created } = fakePrisma();
    const result = await handleShopifyWebhook(prisma, connection, 'customers/create', {
      email: 'ada@example.com',
      first_name: 'Ada',
    });
    expect(result.handled).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      email: 'ada@example.com',
      source: 'shopify',
      organizationId: 'org_1',
      workspaceId: 'ws_1',
    });
  });

  it('merges traits onto an existing contact without downgrading the name', async () => {
    const { prisma, updated } = fakePrisma({
      existingContact: { id: 'c1', attributes: { plan: 'pro' }, firstName: 'Ada', lastName: null },
    });
    await handleShopifyWebhook(prisma, connection, 'orders/create', {
      email: 'ada@example.com',
      total_price: '50.00',
      customer: { first_name: 'X', last_name: 'Lovelace' },
    });
    expect(updated[0]!.data.firstName).toBe('Ada'); // existing name kept
    expect(updated[0]!.data.lastName).toBe('Lovelace'); // missing name filled
    expect(updated[0]!.data.attributes).toMatchObject({
      plan: 'pro',
      shopify_last_order_value: 50,
    });
  });

  it('ignores topics it does not map', async () => {
    const { prisma } = fakePrisma();
    expect((await handleShopifyWebhook(prisma, connection, 'products/create', {})).handled).toBe(
      false,
    );
  });
});

describe('POST /webhooks/shopify', () => {
  const integration = { organizationId: 'org_1', workspaceId: 'ws_1', secret: 'shh' };

  function makeApp(opts: FakeOpts = {}) {
    const { prisma } = fakePrisma(opts);
    return createApp({
      prisma,
      redis: new RedisMock() as unknown as RedisLike,
      rateLimit: { max: 1000, windowSeconds: 3600 },
    });
  }

  const body = JSON.stringify({ email: 'ada@example.com', first_name: 'Ada' });
  const headers = (extra: Record<string, string>) => ({
    'x-shopify-shop-domain': 'acme.myshopify.com',
    'x-shopify-topic': 'customers/create',
    ...extra,
  });

  it('404s for an unknown shop', async () => {
    const response = await makeApp().request('/webhooks/shopify', {
      method: 'POST',
      headers: headers({ 'x-shopify-hmac-sha256': sign('shh', body) }),
      body,
    });
    expect(response.status).toBe(404);
  });

  it('401s on a bad signature', async () => {
    const response = await makeApp({ integration }).request('/webhooks/shopify', {
      method: 'POST',
      headers: headers({ 'x-shopify-hmac-sha256': sign('wrong', body) }),
      body,
    });
    expect(response.status).toBe(401);
  });

  it('accepts a correctly-signed webhook', async () => {
    const response = await makeApp({ integration }).request('/webhooks/shopify', {
      method: 'POST',
      headers: headers({ 'x-shopify-hmac-sha256': sign('shh', body) }),
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: true });
  });

  it('400s without the shop and topic headers', async () => {
    const response = await makeApp({ integration }).request('/webhooks/shopify', {
      method: 'POST',
      body,
    });
    expect(response.status).toBe(400);
  });
});
