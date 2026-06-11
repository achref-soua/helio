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
  /** The integration row id — the AAD slot for the sealed signing secret. */
  id: string;
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
    Array<{ id: string; organizationId: string; workspaceId: string; secret: string | null }>
  >`SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId", secret
    FROM webhook_shopify_connection(${shopDomain})`;
  return rows[0] ?? null;
}

export interface SuppressibleContact {
  id: string;
  organizationId: string;
  workspaceId: string;
}

/**
 * Every ACTIVE contact holding an address, across all workspaces — the
 * lookup behind bounce/complaint suppression. A bad address is bad for the
 * whole deployment's sending reputation, not for one tenant.
 */
export async function activeContactsByEmailForWebhook(
  prisma: PrismaClient,
  email: string,
): Promise<SuppressibleContact[]> {
  return prisma.$queryRaw<SuppressibleContact[]>`
    SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId"
    FROM webhook_contacts_by_email(${email})`;
}
