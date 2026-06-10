import { signStripePayload } from '@helio/core';
import RedisMock from 'ioredis-mock';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { handleStripeEvent } from '../src/routes/stripe-webhook';
import type { GatewayDeps, RedisLike } from '../src/types';

const SECRET = 'whsec_test';
const PRICE_PRO = 'price_pro_123';

/** A Prisma stub capturing subscription upserts and the resolver lookup. */
function fakePrisma(orgByCustomer: string | null = null) {
  const upserts: Array<{
    where: unknown;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];
  const prisma: Record<string, unknown> = {
    // The customer→org lookup runs through the SECURITY DEFINER webhook
    // resolver, i.e. raw SQL (ADR-0017).
    $queryRaw: vi.fn().mockResolvedValue([{ organizationId: orgByCustomer }]),
    subscription: {
      upsert: vi.fn(async (args: (typeof upserts)[number]) => {
        upserts.push(args);
        return {};
      }),
    },
  };
  // forTenant() extends the client; the stub hands back itself.
  prisma.$extends = () => prisma;
  return { prisma: prisma as never, upserts };
}

const priceToPlan = { [PRICE_PRO]: 'PRO' as const };

describe('handleStripeEvent', () => {
  it('maps a subscription price to a plan and upserts by org from metadata', async () => {
    const { prisma, upserts } = fakePrisma();
    const result = await handleStripeEvent(
      prisma,
      {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            customer: 'cus_1',
            status: 'active',
            current_period_end: 1_700_000_000,
            metadata: { organizationId: 'org_1' },
            items: { data: [{ price: { id: PRICE_PRO } }] },
          },
        },
      },
      priceToPlan,
    );
    expect(result.handled).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.where).toEqual({ organizationId: 'org_1' });
    expect(upserts[0]!.update).toMatchObject({ plan: 'PRO', status: 'active' });
  });

  it('resolves the org by Stripe customer when metadata is absent', async () => {
    const { prisma, upserts } = fakePrisma('org_byCustomer');
    const result = await handleStripeEvent(
      prisma,
      {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_2', customer: 'cus_9', status: 'active', items: { data: [] } } },
      },
      priceToPlan,
    );
    expect(result.handled).toBe(true);
    expect(upserts[0]!.where).toEqual({ organizationId: 'org_byCustomer' });
  });

  it('downgrades to FREE on cancellation', async () => {
    const { prisma, upserts } = fakePrisma();
    await handleStripeEvent(
      prisma,
      {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_3', metadata: { organizationId: 'org_1' } } },
      },
      priceToPlan,
    );
    expect(upserts[0]!.update).toMatchObject({ plan: 'FREE', status: 'canceled' });
  });

  it('ignores unknown event types and unresolvable orgs', async () => {
    const { prisma, upserts } = fakePrisma();
    expect(
      (await handleStripeEvent(prisma, { type: 'invoice.paid', data: { object: {} } }, priceToPlan))
        .handled,
    ).toBe(false);
    // Known type but no org to attribute it to.
    expect(
      (
        await handleStripeEvent(
          prisma,
          {
            type: 'customer.subscription.updated',
            data: { object: { id: 's', items: { data: [] } } },
          },
          priceToPlan,
        )
      ).handled,
    ).toBe(false);
    expect(upserts).toHaveLength(0);
  });
});

describe('POST /webhooks/stripe', () => {
  function makeApp(stripe?: GatewayDeps['stripe']) {
    const { prisma } = fakePrisma();
    return createApp({
      prisma,
      redis: new RedisMock() as unknown as RedisLike,
      rateLimit: { max: 1000, windowSeconds: 3600 },
      stripe,
    });
  }

  const body = JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', metadata: { organizationId: 'org_1' }, items: { data: [] } } },
  });

  it('404s when Stripe is not configured', async () => {
    const response = await makeApp(undefined).request('/webhooks/stripe', {
      method: 'POST',
      body,
    });
    expect(response.status).toBe(404);
  });

  it('accepts a correctly-signed event', async () => {
    const app = makeApp({ webhookSecret: SECRET, priceToPlan });
    const ts = Math.floor(Date.now() / 1000);
    const signature = await signStripePayload(body, SECRET, ts);
    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: true });
  });

  it('rejects a bad signature with 400', async () => {
    const app = makeApp({ webhookSecret: SECRET, priceToPlan });
    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      body,
    });
    expect(response.status).toBe(400);
  });

  it('is reachable without the bearer token (signature auth only)', async () => {
    // No Authorization header at all — the /v1 bearer guard must not apply.
    const app = makeApp({ webhookSecret: SECRET, priceToPlan });
    const ts = Math.floor(Date.now() / 1000);
    const signature = await signStripePayload(body, SECRET, ts);
    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body,
    });
    expect(response.status).toBe(200);
  });
});
