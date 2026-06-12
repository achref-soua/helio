import { journeyDefinitionSchema, newId } from '@helio/core';
import type { Prisma } from '@helio/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requirePermission, router } from '../init';

export const journeyRouter = router({
  list: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const journeys = await ctx.tenantDb.journey.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'desc' },
      });
      const counts = await ctx.tenantDb.journeyRun.groupBy({
        by: ['journeyId', 'status'],
        where: { journey: { workspaceId: input.workspaceId } },
        _count: true,
      });
      const byJourney = new Map<string, Record<string, number>>();
      for (const row of counts) {
        const entry = byJourney.get(row.journeyId) ?? {};
        entry[row.status] = row._count;
        byJourney.set(row.journeyId, entry);
      }
      return journeys.map((journey) => ({
        ...journey,
        runCounts: byJourney.get(journey.id) ?? {},
      }));
    }),

  get: orgProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const journey = await ctx.tenantDb.journey.findUnique({ where: { id: input.id } });
    if (!journey) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journey not found' });
    return journey;
  }),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        definition: journeyDefinitionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'journeys:manage');
      const existing = await ctx.tenantDb.journey.findFirst({
        where: { workspaceId: input.workspaceId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A journey with this name exists' });
      }
      const journey = await ctx.tenantDb.journey.create({
        data: {
          id: newId('jny'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          definition: input.definition as unknown as Prisma.InputJsonValue,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'journey.created',
          targetType: 'journey',
          targetId: journey.id,
        },
      });
      return journey;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        definition: journeyDefinitionSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'journeys:manage');
      const journey = await ctx.tenantDb.journey.update({
        where: { id: input.id },
        data: {
          name: input.name,
          ...(input.definition
            ? { definition: input.definition as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: journey.workspaceId,
          actorId: ctx.session.user.id,
          action: 'journey.updated',
          targetType: 'journey',
          targetId: journey.id,
        },
      });
      return journey;
    }),

  /** Flip ACTIVE/PAUSED. New runs only enroll while ACTIVE (ADR-0012). */
  setStatus: orgProcedure
    .input(z.object({ id: z.string().min(1), status: z.enum(['ACTIVE', 'PAUSED']) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'journeys:manage');
      const existing = await ctx.tenantDb.journey.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journey not found' });
      // Refuse to activate a definition the engine would reject.
      if (input.status === 'ACTIVE') {
        const parsed = journeyDefinitionSchema.safeParse(existing.definition);
        if (!parsed.success) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'The journey graph is incomplete or invalid',
          });
        }
      }
      const journey = await ctx.tenantDb.journey.update({
        where: { id: input.id },
        data: { status: input.status },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: journey.workspaceId,
          actorId: ctx.session.user.id,
          action: input.status === 'ACTIVE' ? 'journey.activated' : 'journey.paused',
          targetType: 'journey',
          targetId: journey.id,
        },
      });
      return journey;
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'journeys:manage');
      const journey = await ctx.tenantDb.journey.findUnique({ where: { id: input.id } });
      if (!journey) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journey not found' });
      if (journey.status === 'ACTIVE') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Pause the journey before deleting it' });
      }
      await ctx.tenantDb.journey.delete({ where: { id: journey.id } });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: journey.workspaceId,
          actorId: ctx.session.user.id,
          action: 'journey.deleted',
          targetType: 'journey',
          targetId: journey.id,
        },
      });
      return { id: journey.id };
    }),
});
