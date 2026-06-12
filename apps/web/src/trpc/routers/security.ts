import { newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * Org security policy (M1, owner requirement): admin-configurable
 * password rotation. Enforcement lives in the dashboard layout — an
 * expired password gets exactly one page until it changes.
 */
export const securityRouter = router({
  passwordPolicy: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.tenantDb.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { passwordExpiryEnabled: true, passwordExpiryDays: true },
    });
    if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
    return org;
  }),

  updatePasswordPolicy: orgProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        days: z.number().int().min(7).max(365),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:workspace');
      await ctx.tenantDb.organization.update({
        where: { id: ctx.organizationId },
        data: { passwordExpiryEnabled: input.enabled, passwordExpiryDays: input.days },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          actorId: ctx.session.user.id,
          action: 'security.password_policy_updated',
          targetType: 'organization',
          targetId: ctx.organizationId,
          metadata: { enabled: input.enabled, days: input.days },
        },
      });
      return { ok: true };
    }),
});
