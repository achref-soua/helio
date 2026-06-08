import { newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { intelligence } from '@/lib/intelligence';

import { orgProcedure, requireRole, router } from '../init';

export const scoringRouter = router({
  // Train + write conversion-propensity and churn-risk for the workspace.
  // Delegates to the intelligence plane (RLS-scoped); the dashboard fires
  // it on demand. Degrades to an actionable error when the AI plane is off.
  recompute: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const result = await intelligence.recompute({
        organization_id: ctx.organizationId,
        workspace_id: input.workspaceId,
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'predictions.recomputed',
          targetType: 'workspace',
          targetId: input.workspaceId,
        },
      });
      return result;
    }),

  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.scoringRule.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'asc' },
    }),
  ),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        event: z.string().trim().min(1).max(200),
        points: z.number().int().min(-1000).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const existing = await ctx.tenantDb.scoringRule.findFirst({
        where: { workspaceId: input.workspaceId, event: input.event },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A rule for this event exists' });
      }
      const rule = await ctx.tenantDb.scoringRule.create({
        data: {
          id: newId('score'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          event: input.event,
          points: input.points,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'scoring_rule.created',
          targetType: 'scoring_rule',
          targetId: rule.id,
        },
      });
      return rule;
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const rule = await ctx.tenantDb.scoringRule.delete({ where: { id: input.id } });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: rule.workspaceId,
          actorId: ctx.session.user.id,
          action: 'scoring_rule.deleted',
          targetType: 'scoring_rule',
          targetId: rule.id,
        },
      });
      return { id: rule.id };
    }),
});
