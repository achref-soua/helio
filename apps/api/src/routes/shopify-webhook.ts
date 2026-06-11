import {
  decryptField,
  isEnvelope,
  newId,
  shopifyContactForTopic,
  verifyShopifyHmac,
} from '@helio/core';
import { forTenant, type Prisma, shopifyConnectionForWebhook, type TenantClient } from '@helio/db';
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
  prisma: TenantClient,
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

    // No tenant context exists yet — the shop domain is resolved through
    // the SECURITY DEFINER webhook resolver (ADR-0017), never a raw read.
    const integration = await shopifyConnectionForWebhook(deps.prisma, shop);
    if (!integration?.secret) return c.json({ error: 'unknown_shop' }, 404);

    // Secrets written since ADR-0019 arrive sealed; rows from before the
    // vault stay plaintext and verify directly.
    let signingSecret = integration.secret;
    if (isEnvelope(signingSecret)) {
      if (!deps.vault) return c.json({ error: 'vault_key_missing' }, 503);
      try {
        signingSecret = await decryptField(
          signingSecret,
          {
            organizationId: integration.organizationId,
            credentialId: integration.id,
            field: 'secret',
          },
          deps.vault.key,
          deps.vault.previousKey,
        );
      } catch {
        return c.json({ error: 'vault_key_mismatch' }, 503);
      }
    }

    const body = await c.req.text();
    const valid = await verifyShopifyHmac(
      signingSecret,
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

    const result = await handleShopifyWebhook(
      forTenant(deps.prisma, integration.organizationId),
      integration,
      topic,
      payload,
    );
    return c.json({ received: true, handled: result.handled }, 200);
  });

  return app;
}
