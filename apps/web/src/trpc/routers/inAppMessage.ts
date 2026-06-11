import { newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';

import { orgProcedure, requirePermission, router } from '../init';

const ctaUrlSchema = z.string().trim().url().max(2000);

/**
 * In-app messages shown inside the customer's product to identified visitors.
 * Authors manage content here; journeys queue per-contact deliveries via the
 * send_in_app node, and the tracking SDK drains them through a public endpoint.
 */
export const inAppMessageRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.inAppMessage.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'desc' },
    }),
  ),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(1000),
        ctaLabel: z.string().trim().max(60).optional(),
        ctaUrl: ctaUrlSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'inapp:write');
      const message = await ctx.tenantDb.inAppMessage.create({
        data: {
          id: newId('iam'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          title: input.title,
          body: input.body,
          ctaLabel: input.ctaLabel || null,
          ctaUrl: input.ctaUrl || null,
        },
      });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'inapp.created',
        targetType: 'in_app_message',
        targetId: message.id,
      });
      return { id: message.id };
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        title: z.string().trim().min(1).max(160).optional(),
        body: z.string().trim().min(1).max(1000).optional(),
        ctaLabel: z.string().trim().max(60).nullable().optional(),
        ctaUrl: ctaUrlSchema.nullable().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'inapp:write');
      const { id, ...rest } = input;
      const { count } = await ctx.tenantDb.inAppMessage.updateMany({
        where: { id },
        data: {
          name: rest.name,
          title: rest.title,
          body: rest.body,
          active: rest.active,
          ...(rest.ctaLabel !== undefined ? { ctaLabel: rest.ctaLabel } : {}),
          ...(rest.ctaUrl !== undefined ? { ctaUrl: rest.ctaUrl } : {}),
        },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'inapp.updated',
        targetType: 'in_app_message',
        targetId: id,
      });
      return { id };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'inapp:write');
      const { count } = await ctx.tenantDb.inAppMessage.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'inapp.deleted',
        targetType: 'in_app_message',
        targetId: input.id,
      });
      return { ok: true };
    }),
});
