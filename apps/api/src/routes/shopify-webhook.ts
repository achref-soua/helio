import { newId, shopifyContactForTopic, verifyShopifyHmac } from '@helio/core';
import { type Prisma, type PrismaClient } from '@helio/db';
import { Hono } from 'hono';

import type { GatewayDeps, GatewayEnv } from '../types';

interface ShopifyConnection {
  organizationId: string;
  workspaceId: string;
}

/**
 * Apply a verified Shopify webhook to the CDP: upsert the contact derived from
 * the payload into the integration's workspace, merging Shopify traits onto an
 * existing contact without downgrading a known first/last name. Pure of HTTP so
 * it can be unit-tested directly.
 */
export async function handleShopifyWebhook(
  prisma: PrismaClient,
  connection: ShopifyConnection,
  topic: string,
  payload: unknown,
): Promise<{ handled: boolean }> {
  const mapped = shopifyContactForTopic(topic, payload);
  if (!mapped) return { handled: false };

  const existing = await prisma.contact.findUnique({
    where: {
      workspaceId_email: { workspaceId: connection.workspaceId, email: mapped.email },
    },
    select: { id: true, attributes: true, firstName: true, lastName: true },
  });

  if (existing) {
    const attributes = {
      ...(existing.attributes as Record<string, unknown>),
      ...mapped.attributes,
    } as Prisma.InputJsonValue;
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        attributes,
        firstName: existing.firstName ?? mapped.firstName,
        lastName: existing.lastName ?? mapped.lastName,
      },
    });
    return { handled: true };
  }

  const contact = await prisma.contact.create({
    data: {
      id: newId('contact'),
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      email: mapped.email,
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      attributes: mapped.attributes as Prisma.InputJsonValue,
      source: 'shopify',
    },
  });
  await prisma.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      action: 'contact.created',
      targetType: 'contact',
      targetId: contact.id,
      metadata: { via: 'shopify', topic },
    },
  });
  return { handled: true };
}

/**
 * Shopify webhook endpoint. Authenticated by Shopify's per-app HMAC (not the
 * bearer token), so it is mounted outside /v1. The shop domain header resolves
 * the connection — and its signing secret — then the body is verified against
 * it. An unknown shop is 404; a bad signature is 401.
 */
export function shopifyWebhookRoutes(deps: GatewayDeps) {
  const app = new Hono<GatewayEnv>();

  app.post('/webhooks/shopify', async (c) => {
    const shop = c.req.header('x-shopify-shop-domain');
    const topic = c.req.header('x-shopify-topic');
    if (!shop || !topic) return c.json({ error: 'missing_headers' }, 400);

    const integration = await deps.prisma.integration.findFirst({
      where: { provider: 'SHOPIFY', externalId: shop, enabled: true },
      select: { organizationId: true, workspaceId: true, secret: true },
    });
    if (!integration?.secret) return c.json({ error: 'unknown_shop' }, 404);

    const body = await c.req.text();
    const valid = await verifyShopifyHmac(
      integration.secret,
      body,
      c.req.header('x-shopify-hmac-sha256'),
    );
    if (!valid) return c.json({ error: 'invalid_signature' }, 401);

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const result = await handleShopifyWebhook(deps.prisma, integration, topic, payload);
    return c.json({ received: true, handled: result.handled }, 200);
  });

  return app;
}
