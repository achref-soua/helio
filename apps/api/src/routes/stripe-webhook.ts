import { newId, type Plan, verifyStripeSignature } from '@helio/core';
import type { PrismaClient } from '@helio/db';
import { Hono } from 'hono';

import type { GatewayDeps, GatewayEnv } from '../types';

/** The Stripe event shape we read — only the fields we act on. */
interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

interface SubscriptionPatch {
  plan?: Plan;
  status?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: Date;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Resolve the org an event belongs to: explicit metadata, else by customer. */
async function resolveOrgId(
  prisma: PrismaClient,
  object: Record<string, unknown>,
): Promise<string | null> {
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  const explicit = str(metadata.organizationId) ?? str(object.client_reference_id);
  if (explicit) return explicit;
  const customer = str(object.customer);
  if (customer) {
    const existing = await prisma.subscription.findFirst({
      where: { stripeCustomerId: customer },
      select: { organizationId: true },
    });
    if (existing) return existing.organizationId;
  }
  return null;
}

async function upsertSubscription(
  prisma: PrismaClient,
  organizationId: string,
  patch: SubscriptionPatch,
): Promise<void> {
  const update = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  await prisma.subscription.upsert({
    where: { organizationId },
    // A brand-new Stripe-managed org starts on FREE unless the event maps
    // a paid price; self-hosted orgs simply never get a row.
    create: { id: newId('sub'), organizationId, plan: patch.plan ?? 'FREE', ...update },
    update,
  });
}

function pricePlan(
  object: Record<string, unknown>,
  priceToPlan: Record<string, Plan>,
): Plan | undefined {
  const items = (object.items ?? {}) as { data?: Array<{ price?: { id?: string } }> };
  const priceId = items.data?.[0]?.price?.id;
  return priceId ? priceToPlan[priceId] : undefined;
}

/**
 * Apply a verified Stripe event to the subscription table. Pure of HTTP so
 * it can be unit-tested directly. Unknown event types are ignored.
 */
export async function handleStripeEvent(
  prisma: PrismaClient,
  event: StripeEvent,
  priceToPlan: Record<string, Plan>,
): Promise<{ handled: boolean }> {
  const object = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const orgId = await resolveOrgId(prisma, object);
      if (!orgId) return { handled: false };
      await upsertSubscription(prisma, orgId, {
        status: 'active',
        stripeCustomerId: str(object.customer),
        stripeSubscriptionId: str(object.subscription),
      });
      return { handled: true };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const orgId = await resolveOrgId(prisma, object);
      if (!orgId) return { handled: false };
      const periodEnd = object.current_period_end;
      await upsertSubscription(prisma, orgId, {
        plan: pricePlan(object, priceToPlan),
        status: str(object.status),
        stripeCustomerId: str(object.customer),
        stripeSubscriptionId: str(object.id),
        currentPeriodEnd: typeof periodEnd === 'number' ? new Date(periodEnd * 1000) : undefined,
      });
      return { handled: true };
    }
    case 'customer.subscription.deleted': {
      const orgId = await resolveOrgId(prisma, object);
      if (!orgId) return { handled: false };
      // Cancellation downgrades to FREE rather than deleting the row.
      await upsertSubscription(prisma, orgId, { plan: 'FREE', status: 'canceled' });
      return { handled: true };
    }
    default:
      return { handled: false };
  }
}

/**
 * Stripe webhook endpoint. Signature-authenticated (not the bearer token),
 * so it is mounted outside /v1. Returns 200 quickly; a bad signature is
 * 400, and an unconfigured deployment is 404 so the rest of the API still
 * runs without Stripe.
 */
export function stripeWebhookRoutes(deps: GatewayDeps) {
  const app = new Hono<GatewayEnv>();

  app.post('/webhooks/stripe', async (c) => {
    if (!deps.stripe) return c.json({ error: 'stripe_disabled' }, 404);
    const body = await c.req.text();
    const valid = await verifyStripeSignature(
      body,
      c.req.header('stripe-signature'),
      deps.stripe.webhookSecret,
    );
    if (!valid) return c.json({ error: 'invalid_signature' }, 400);

    let event: StripeEvent;
    try {
      event = JSON.parse(body) as StripeEvent;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const result = await handleStripeEvent(deps.prisma, event, deps.stripe.priceToPlan);
    return c.json({ received: true, handled: result.handled }, 200);
  });

  return app;
}
