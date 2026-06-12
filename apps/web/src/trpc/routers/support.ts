import { newId, supportKindSchema, supportStatusSchema } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * In-app support / bug reports. Any member can file a ticket; admins triage
 * and resolve. Org-scoped through the tenant client.
 */
export const supportRouter = router({
  create: orgProcedure
    .input(
      z.object({
        kind: supportKindSchema.default('BUG'),
        subject: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(5000),
        url: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ticket = await ctx.tenantDb.supportTicket.create({
        data: {
          id: newId('tkt'),
          organizationId: ctx.organizationId,
          reporterId: ctx.session.user.id,
          kind: input.kind,
          subject: input.subject,
          body: input.body,
          url: input.url,
        },
      });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'support.created',
        targetType: 'support_ticket',
        targetId: ticket.id,
      });
      return { id: ticket.id };
    }),

  list: orgProcedure
    .input(z.object({ status: supportStatusSchema.optional() }).optional())
    .query(({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:support');
      return ctx.tenantDb.supportTicket.findMany({
        where: input?.status ? { status: input.status } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          kind: true,
          subject: true,
          body: true,
          url: true,
          status: true,
          reporterId: true,
          createdAt: true,
        },
      });
    }),

  setStatus: orgProcedure
    .input(z.object({ id: z.string().min(1), status: supportStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:support');
      const { count } = await ctx.tenantDb.supportTicket.updateMany({
        where: { id: input.id },
        data: { status: input.status },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'support.status_changed',
        targetType: 'support_ticket',
        targetId: input.id,
      });
      return { id: input.id };
    }),
});
