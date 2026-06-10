import type { PrismaClient } from './client';

/**
 * Tenant resolvers for signature-authenticated webhooks (ADR-0017).
 *
 * The gateway connects as the RLS-bound app role, which sees no tenant rows
 * until an org context is set — but a webhook's org isn't known until its
 * payload is matched to one. These wrappers call the narrow SECURITY
 * DEFINER functions installed by the migrations; everything after
 * resolution runs through forTenant() as usual.
 */

export interface ShopifyWebhookConnection {
  organizationId: string;
  workspaceId: string;
  secret: string | null;
}

/** Resolve the enabled Shopify integration routing a shop domain, if any. */
export async function shopifyConnectionForWebhook(
  prisma: PrismaClient,
  shopDomain: string,
): Promise<ShopifyWebhookConnection | null> {
  const rows = await prisma.$queryRaw<
    Array<{ organizationId: string; workspaceId: string; secret: string | null }>
  >`SELECT organization_id AS "organizationId", workspace_id AS "workspaceId", secret
    FROM webhook_shopify_connection(${shopDomain})`;
  return rows[0] ?? null;
}

/** Resolve the org owning a Stripe customer id, if any subscription has it. */
export async function stripeOrganizationForWebhook(
  prisma: PrismaClient,
  customerId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ organizationId: string | null }>>`
    SELECT webhook_stripe_organization(${customerId}) AS "organizationId"`;
  return rows[0]?.organizationId ?? null;
}
