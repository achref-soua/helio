import { defaultPalette, newId, surfacePaletteSchema, widgetTypeSchema } from '@helio/core';
import { type Prisma } from '@helio/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';

import { orgProcedure, requirePermission, router } from '../init';

// http(s) only: the public widget assigns this straight to an anchor's href
// in plain DOM, so a `javascript:`/`data:` URL would be stored XSS on the
// customer's own site. Zod's .url() alone accepts those schemes.
const ctaUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), 'URL must be http(s)');

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
        palette: surfacePaletteSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'widgets:write');
      // Seed the palette from the org brand color so a new widget is on-brand.
      const org = await ctx.tenantDb.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { brandColor: true },
      });
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
          palette: input.palette ?? defaultPalette(org?.brandColor),
        },
      });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'widget.created',
        targetType: 'widget',
        targetId: widget.id,
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
        palette: surfacePaletteSchema.optional(),
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
          ...(rest.palette ? { palette: rest.palette as Prisma.InputJsonValue } : {}),
        },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'widget.updated',
        targetType: 'widget',
        targetId: id,
      });
      return { id };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'widgets:write');
      const { count } = await ctx.tenantDb.widget.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'widget.deleted',
        targetType: 'widget',
        targetId: input.id,
      });
      return { ok: true };
    }),
});
