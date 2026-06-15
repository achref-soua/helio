import { defaultPalette, newId, surfacePaletteSchema } from '@helio/core';
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
      // Seed the palette from the org brand color so a new form is on-brand out
      // of the box; the creator can re-theme any role afterward.
      const org = await ctx.tenantDb.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { brandColor: true },
      });
      const form = await ctx.tenantDb.form.create({
        data: {
          id: newId('form'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          title: input.title,
          palette: defaultPalette(org?.brandColor),
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

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().trim().min(1).max(200).optional(),
        palette: surfacePaletteSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'forms:write');
      const form = await ctx.tenantDb.form.update({
        where: { id: input.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.palette !== undefined ? { palette: input.palette } : {}),
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: form.workspaceId,
          actorId: ctx.session.user.id,
          action: 'form.updated',
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
