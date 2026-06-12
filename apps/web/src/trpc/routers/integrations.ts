import { newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';
import { sealRowSecret } from '@/lib/vault';

import { orgProcedure, requirePermission, router } from '../init';

const shopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, 'Must be a *.myshopify.com domain');

const instanceUrlSchema = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine(
    (value) => /^https:\/\//i.test(value) && /\.(salesforce|force)\.com/i.test(value),
    'Must be an https Salesforce instance URL',
  );

/**
 * External platform connections. Shopify stores the shop domain (externalId)
 * and the app's webhook-signing secret; inbound webhooks land on the gateway
 * and upsert contacts into the connection's workspace. Admin-gated and reached
 * through the tenant client.
 */
export const integrationsRouter = router({
  list: orgProcedure.query(({ ctx }) => {
    requirePermission(ctx.memberRole, 'settings:integrations');
    return ctx.tenantDb.integration.findMany({
      select: { id: true, provider: true, externalId: true, enabled: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }),

  connectShopify: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        shopDomain: shopDomainSchema,
        secret: z.string().trim().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:integrations');
      try {
        // The envelope AAD binds the secret to its row id, so resolve the
        // id before sealing (upsert would only reveal it afterwards).
        const existing = await ctx.tenantDb.integration.findUnique({
          where: {
            organizationId_provider: { organizationId: ctx.organizationId, provider: 'SHOPIFY' },
          },
          select: { id: true },
        });
        const id = existing?.id ?? newId('intg');
        const secret = await sealRowSecret(ctx.organizationId, id, 'secret', input.secret);
        const integration = await ctx.tenantDb.integration.upsert({
          where: {
            organizationId_provider: {
              organizationId: ctx.organizationId,
              provider: 'SHOPIFY',
            },
          },
          create: {
            id,
            organizationId: ctx.organizationId,
            workspaceId: input.workspaceId,
            provider: 'SHOPIFY',
            externalId: input.shopDomain,
            secret,
          },
          update: {
            workspaceId: input.workspaceId,
            externalId: input.shopDomain,
            secret,
            enabled: true,
          },
        });
        await writeAudit(ctx.tenantDb, {
          organizationId: ctx.organizationId,
          actorId: ctx.session.user.id,
          action: 'integration.connected',
          targetType: 'integration',
          targetId: integration.id,
          metadata: { kind: 'shopify' },
        });
        await writeAudit(ctx.tenantDb, {
          organizationId: ctx.organizationId,
          actorId: ctx.session.user.id,
          action: 'integration.connected',
          targetType: 'integration',
          targetId: integration.id,
          metadata: { kind: 'salesforce' },
        });
        return { id: integration.id };
      } catch (error) {
        if (error instanceof Error && error.message.includes('HELIO_ENCRYPTION_KEY')) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
        }
        // Unique (provider, externalId) — the shop is wired to another org.
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'That shop is already connected to another organization',
        });
      }
    }),

  connectSalesforce: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        instanceUrl: instanceUrlSchema,
        accessToken: z.string().trim().min(8).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:integrations');
      const existing = await ctx.tenantDb.integration.findUnique({
        where: {
          organizationId_provider: { organizationId: ctx.organizationId, provider: 'SALESFORCE' },
        },
        select: { id: true },
      });
      const id = existing?.id ?? newId('intg');
      let secret: string;
      try {
        secret = await sealRowSecret(ctx.organizationId, id, 'secret', input.accessToken);
      } catch (error) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: error instanceof Error ? error.message : 'encryption key missing',
        });
      }
      const integration = await ctx.tenantDb.integration.upsert({
        where: {
          organizationId_provider: { organizationId: ctx.organizationId, provider: 'SALESFORCE' },
        },
        create: {
          id,
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          provider: 'SALESFORCE',
          secret,
          config: { instanceUrl: input.instanceUrl },
        },
        update: {
          workspaceId: input.workspaceId,
          secret,
          config: { instanceUrl: input.instanceUrl },
          enabled: true,
        },
      });
      return { id: integration.id };
    }),

  setEnabled: orgProcedure
    .input(z.object({ id: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:integrations');
      const { count } = await ctx.tenantDb.integration.updateMany({
        where: { id: input.id },
        data: { enabled: input.enabled },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'integration.toggled',
        targetType: 'integration',
        targetId: input.id,
        metadata: { enabled: input.enabled },
      });
      return { id: input.id };
    }),

  disconnect: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:integrations');
      const { count } = await ctx.tenantDb.integration.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'integration.disconnected',
        targetType: 'integration',
        targetId: input.id,
      });
      return { ok: true };
    }),
});
