import { newId, widgetTypeSchema } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requirePermission, router } from '../init';

const ctaUrlSchema = z.string().trim().url().max(2000);

/**
 * On-site widgets (banners / popups) shown to visitors by the public embed.
 * Managed through the tenant client; the embed reads active widgets via a
 * write-key-scoped public endpoint.
 */
export const widgetRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.widget.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'desc' },
    }),
  ),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        type: widgetTypeSchema.default('BANNER'),
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(1000),
        ctaLabel: z.string().trim().max(60).optional(),
        ctaUrl: ctaUrlSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'widgets:write');
      const widget = await ctx.tenantDb.widget.create({
        data: {
          id: newId('wgt'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          type: input.type,
          title: input.title,
          body: input.body,
          ctaLabel: input.ctaLabel || null,
          ctaUrl: input.ctaUrl || null,
        },
      });
      return { id: widget.id };
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        type: widgetTypeSchema.optional(),
        title: z.string().trim().min(1).max(160).optional(),
        body: z.string().trim().min(1).max(1000).optional(),
        ctaLabel: z.string().trim().max(60).nullable().optional(),
        ctaUrl: ctaUrlSchema.nullable().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'widgets:write');
      const { id, ...rest } = input;
      const { count } = await ctx.tenantDb.widget.updateMany({
        where: { id },
        data: {
          name: rest.name,
          type: rest.type,
          title: rest.title,
          body: rest.body,
          active: rest.active,
          ...(rest.ctaLabel !== undefined ? { ctaLabel: rest.ctaLabel } : {}),
          ...(rest.ctaUrl !== undefined ? { ctaUrl: rest.ctaUrl } : {}),
        },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'widgets:write');
      const { count } = await ctx.tenantDb.widget.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
});
