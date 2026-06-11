import { newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requirePermission, router } from '../init';

export const formRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.form.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'desc' },
    }),
  ),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'forms:write');
      const existing = await ctx.tenantDb.form.findFirst({
        where: { workspaceId: input.workspaceId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A form with this name exists' });
      }
      const form = await ctx.tenantDb.form.create({
        data: {
          id: newId('form'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          title: input.title,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'form.created',
          targetType: 'form',
          targetId: form.id,
        },
      });
      return form;
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'forms:write');
      const form = await ctx.tenantDb.form.delete({ where: { id: input.id } });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: form.workspaceId,
          actorId: ctx.session.user.id,
          action: 'form.deleted',
          targetType: 'form',
          targetId: form.id,
        },
      });
      return { id: form.id };
    }),
});
