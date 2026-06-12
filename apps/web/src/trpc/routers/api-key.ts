import { API_SCOPES, generateGatewayApiKey, newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * Public REST gateway API keys. Unlike SSO/SCIM credentials these live in an
 * RLS domain table, so reads and writes go through the tenant-scoped client —
 * a key is created, listed, and revoked entirely within the caller's org.
 * Only the hash is stored; the plaintext is returned by `create` exactly once.
 */
export const apiKeyRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'settings:api-keys');
    return ctx.tenantDb.gatewayApiKey.findMany({
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(60),
        scopes: z.array(z.enum(API_SCOPES)).min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:api-keys');
      const { key, keyHash, prefix } = await generateGatewayApiKey(ctx.organizationId);
      await ctx.tenantDb.gatewayApiKey.create({
        data: {
          id: newId('gwk'),
          organizationId: ctx.organizationId,
          name: input.name,
          keyHash,
          prefix,
          // No selection = the full grant, matching pre-scope keys.
          scopes: input.scopes ?? ['*'],
        },
      });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'api_key.created',
        targetType: 'api_key',
        targetId: prefix,
      });
      return { key };
    }),

  revoke: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:api-keys');
      // RLS scopes the delete to the caller's org; a foreign id removes nothing.
      const { count } = await ctx.tenantDb.gatewayApiKey.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'api_key.revoked',
        targetType: 'api_key',
        targetId: input.id,
      });
      return { ok: true };
    }),
});
