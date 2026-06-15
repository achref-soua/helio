import { defaultPalette, landingDocumentSchema, newId, surfacePaletteSchema } from '@helio/core';
import { type Prisma } from '@helio/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * Hosted, block-based landing pages. Managed through the tenant client;
 * the public page (/p/<id>) is rendered server-side from the stored blocks.
 */
export const landingRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.landingPage.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true, title: true, published: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ),

  get: orgProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const page = await ctx.tenantDb.landingPage.findUnique({ where: { id: input.id } });
    if (!page) throw new TRPCError({ code: 'NOT_FOUND' });
    return page;
  }),

  create: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), title: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'landing:write');
      // Seed the palette from the org brand color so a new page is on-brand.
      const org = await ctx.tenantDb.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { brandColor: true },
      });
      const page = await ctx.tenantDb.landingPage.create({
        data: {
          id: newId('lp'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          title: input.title,
          blocks: [],
          palette: defaultPalette(org?.brandColor),
        },
      });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'landing.created',
        targetType: 'landing_page',
        targetId: page.id,
      });
      return { id: page.id };
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().trim().min(1).max(120).optional(),
        blocks: landingDocumentSchema.optional(),
        palette: surfacePaletteSchema.optional(),
        published: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'landing:write');
      const { id, ...rest } = input;
      const { count } = await ctx.tenantDb.landingPage.updateMany({
        where: { id },
        data: {
          title: rest.title,
          published: rest.published,
          ...(rest.blocks ? { blocks: rest.blocks as Prisma.InputJsonValue } : {}),
          ...(rest.palette ? { palette: rest.palette as Prisma.InputJsonValue } : {}),
        },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'landing.updated',
        targetType: 'landing_page',
        targetId: id,
      });
      return { id };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'landing:write');
      const { count } = await ctx.tenantDb.landingPage.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'landing.deleted',
        targetType: 'landing_page',
        targetId: input.id,
      });
      return { ok: true };
    }),
});
