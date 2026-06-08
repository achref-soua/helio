import { newId, segmentRuleSchema } from '@helio/core';
import { compileSegmentRule, type Prisma } from '@helio/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveEventConditions } from '@/lib/segment-events';

import { orgProcedure, requireRole, router } from '../init';

const PREVIEW_SAMPLE_SIZE = 5;

export const segmentRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.segment.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'asc' },
    }),
  ),

  /**
   * Live evaluation of a rule (saved or draft): match count plus a small
   * sample so the builder can show who it captures.
   */
  preview: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), rule: segmentRuleSchema }))
    .query(async ({ ctx, input }) => {
      const eventSets = await resolveEventConditions(input.rule, input.workspaceId);
      const where = {
        AND: [{ workspaceId: input.workspaceId }, compileSegmentRule(input.rule, eventSets)],
      };
      const [count, sample] = await Promise.all([
        ctx.tenantDb.contact.count({ where }),
        ctx.tenantDb.contact.findMany({
          where,
          orderBy: { id: 'desc' },
          take: PREVIEW_SAMPLE_SIZE,
          select: { id: true, email: true, firstName: true, lastName: true },
        }),
      ]);
      return { count, sample };
    }),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).optional(),
        rule: segmentRuleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const existing = await ctx.tenantDb.segment.findFirst({
        where: { workspaceId: input.workspaceId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A segment with this name exists' });
      }
      const segment = await ctx.tenantDb.segment.create({
        data: {
          id: newId('seg'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          description: input.description,
          // zod-validated above; the recursive type just isn't assignable to InputJsonValue
          rule: input.rule as unknown as Prisma.InputJsonValue,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'segment.created',
          targetType: 'segment',
          targetId: segment.id,
        },
      });
      return segment;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(500).nullish(),
        rule: segmentRuleSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const segment = await ctx.tenantDb.segment.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          ...(input.rule ? { rule: input.rule as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: segment.workspaceId,
          actorId: ctx.session.user.id,
          action: 'segment.updated',
          targetType: 'segment',
          targetId: segment.id,
        },
      });
      return segment;
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const segment = await ctx.tenantDb.segment.delete({ where: { id: input.id } });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: segment.workspaceId,
          actorId: ctx.session.user.id,
          action: 'segment.deleted',
          targetType: 'segment',
          targetId: segment.id,
        },
      });
      return { id: segment.id };
    }),
});
