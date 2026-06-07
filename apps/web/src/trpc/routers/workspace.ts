import { newId } from '@helio/core';
import { z } from 'zod';

import { orgProcedure, requireRole, router } from '../init';

const slugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers, and dashes only');

export const workspaceRouter = router({
  list: orgProcedure.query(({ ctx }) =>
    ctx.tenantDb.workspace.findMany({ orderBy: { createdAt: 'asc' } }),
  ),

  create: orgProcedure
    .input(z.object({ name: z.string().min(1).max(80), slug: slugSchema }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
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
