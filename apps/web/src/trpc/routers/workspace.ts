import { newId } from '@helio/core';
import { Prisma } from '@helio/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requirePermission, router } from '../init';

const slugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers, and dashes only');

export const workspaceRouter = router({
  list: orgProcedure.query(({ ctx }) =>
    ctx.tenantDb.workspace.findMany({ orderBy: { createdAt: 'asc' } }),
  ),

  /** Per-workspace conversion events for predictive scoring; empty list
   *  clears back to the deployment default. Admin-gated. */
  setConversionEvents: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        events: z.array(z.string().trim().min(1).max(80)).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:workspace');
      const events = [...new Set(input.events)];
      const { count } = await ctx.tenantDb.workspace.updateMany({
        where: { id: input.workspaceId },
        data: { conversionEvents: events.length > 0 ? events : Prisma.DbNull },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'workspace.conversion_events_updated',
          targetType: 'workspace',
          targetId: input.workspaceId,
          metadata: { events },
        },
      });
      return { events };
    }),

  create: orgProcedure
    .input(z.object({ name: z.string().min(1).max(80), slug: slugSchema }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'workspaces:create');
      const workspace = await ctx.tenantDb.workspace.create({
        data: {
          id: newId('ws'),
          organizationId: ctx.organizationId,
          name: input.name,
          slug: input.slug,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: workspace.id,
          actorId: ctx.session.user.id,
          action: 'workspace.created',
          targetType: 'workspace',
          targetId: workspace.id,
        },
      });
      return workspace;
    }),
});
