import { newId, taskPrioritySchema, taskStatusSchema, taskTypeSchema } from '@helio/core';
import { type inferProcedureBuilderResolverOptions, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { emitWebhookEvent } from '@/lib/webhooks';

import { orgProcedure, requirePermission, router } from '../init';

type OrgContext = inferProcedureBuilderResolverOptions<typeof orgProcedure>['ctx'];

/** The default columns a new pipeline ships with. */
const DEFAULT_STAGES: Array<{ name: string; kind: 'OPEN' | 'WON' | 'LOST' }> = [
  { name: 'Lead', kind: 'OPEN' },
  { name: 'Qualified', kind: 'OPEN' },
  { name: 'Proposal', kind: 'OPEN' },
  { name: 'Won', kind: 'WON' },
  { name: 'Lost', kind: 'LOST' },
];

const currencySchema = z.string().trim().toUpperCase().length(3).default('USD');

/**
 * CRM-lite: pipelines, stages, and deals. Everything is workspace-scoped
 * and RLS-isolated; the board query returns one pipeline with its ordered
 * stages and the deals in each, ready to render as a kanban.
 */
export const crmRouter = router({
  pipelines: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.tenantDb.pipeline.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, isDefault: true },
      }),
    ),

  board: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), pipelineId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      const pipeline = await ctx.tenantDb.pipeline.findFirst({
        where: {
          workspaceId: input.workspaceId,
          ...(input.pipelineId ? { id: input.pipelineId } : {}),
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: {
          stages: {
            orderBy: { position: 'asc' },
            include: {
              deals: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  title: true,
                  valueCents: true,
                  currency: true,
                  status: true,
                  position: true,
                  contactId: true,
                  contact: { select: { email: true } },
                },
              },
            },
          },
        },
      });
      return pipeline; // null when the workspace has no pipeline yet
    }),

  createPipeline: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const existing = await ctx.tenantDb.pipeline.findFirst({
        where: { workspaceId: input.workspaceId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A pipeline with this name exists' });
      }
      const count = await ctx.tenantDb.pipeline.count({
        where: { workspaceId: input.workspaceId },
      });
      const pipelineId = newId('pipe');
      await ctx.tenantDb.pipeline.create({
        data: {
          id: pipelineId,
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          isDefault: count === 0,
          stages: {
            create: DEFAULT_STAGES.map((stage, position) => ({
              id: newId('stg'),
              organizationId: ctx.organizationId,
              workspaceId: input.workspaceId,
              name: stage.name,
              kind: stage.kind,
              position,
            })),
          },
        },
      });
      return { id: pipelineId };
    }),

  createDeal: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        pipelineId: z.string().min(1),
        stageId: z.string().min(1),
        title: z.string().trim().min(1).max(160),
        valueCents: z.number().int().min(0).max(1_000_000_000).default(0),
        currency: currencySchema,
        contactId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const stage = await ctx.tenantDb.pipelineStage.findFirst({
        where: { id: input.stageId, pipelineId: input.pipelineId },
        select: { kind: true },
      });
      if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Stage not found' });
      const position = await ctx.tenantDb.deal.count({
        where: { workspaceId: input.workspaceId, stageId: input.stageId },
      });
      const deal = await ctx.tenantDb.deal.create({
        data: {
          id: newId('deal'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          pipelineId: input.pipelineId,
          stageId: input.stageId,
          title: input.title,
          valueCents: input.valueCents,
          currency: input.currency,
          status: stage.kind,
          position,
          contactId: input.contactId,
          closedAt: stage.kind === 'OPEN' ? null : new Date(),
        },
      });
      await writeAudit(ctx, input.workspaceId, 'deal.created', 'deal', deal.id);
      await emitWebhookEvent(
        ctx,
        deal.status === 'WON' ? 'deal.won' : deal.status === 'LOST' ? 'deal.lost' : 'deal.created',
        {
          id: deal.id,
          title: deal.title,
          valueCents: deal.valueCents,
          currency: deal.currency,
          status: deal.status,
          workspaceId: deal.workspaceId,
          contactId: deal.contactId,
        },
      );
      return deal;
    }),

  moveDeal: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        stageId: z.string().min(1),
        position: z.number().int().min(0).max(100_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const deal = await ctx.tenantDb.deal.findUnique({
        where: { id: input.id },
        select: { pipelineId: true, workspaceId: true },
      });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deal not found' });
      const stage = await ctx.tenantDb.pipelineStage.findFirst({
        where: { id: input.stageId, pipelineId: deal.pipelineId },
        select: { kind: true },
      });
      if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Stage not found' });
      // Moving into a terminal column closes the deal; back to open reopens it.
      await ctx.tenantDb.deal.update({
        where: { id: input.id },
        data: {
          stageId: input.stageId,
          position: input.position,
          status: stage.kind,
          closedAt: stage.kind === 'OPEN' ? null : new Date(),
        },
      });
      await writeAudit(ctx, deal.workspaceId, 'deal.moved', 'deal', input.id);
      if (stage.kind === 'WON' || stage.kind === 'LOST') {
        await emitWebhookEvent(ctx, stage.kind === 'WON' ? 'deal.won' : 'deal.lost', {
          id: input.id,
          status: stage.kind,
          workspaceId: deal.workspaceId,
        });
      }
      return { id: input.id };
    }),

  updateDeal: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().trim().min(1).max(160).optional(),
        valueCents: z.number().int().min(0).max(1_000_000_000).optional(),
        currency: z.string().trim().toUpperCase().length(3).optional(),
        contactId: z.string().min(1).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const { id, ...rest } = input;
      const deal = await ctx.tenantDb.deal.update({
        where: { id },
        data: {
          title: rest.title,
          valueCents: rest.valueCents,
          currency: rest.currency,
          ...(rest.contactId !== undefined ? { contactId: rest.contactId } : {}),
        },
      });
      await writeAudit(ctx, deal.workspaceId, 'deal.updated', 'deal', id);
      return { id };
    }),

  deleteDeal: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const deal = await ctx.tenantDb.deal.delete({ where: { id: input.id } });
      await writeAudit(ctx, deal.workspaceId, 'deal.deleted', 'deal', input.id);
      return { id: input.id };
    }),

  // ── Tasks: workspace-scoped to-dos, optionally tied to a contact/deal ──

  tasks: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), status: taskStatusSchema.optional() }))
    .query(({ ctx, input }) =>
      ctx.tenantDb.task.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.status ? { status: input.status } : {}),
        },
        // A stable server order; the client regroups by due date in its own
        // time zone (see groupTasksByBucket).
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          title: true,
          notes: true,
          type: true,
          priority: true,
          status: true,
          dueAt: true,
          completedAt: true,
          contactId: true,
          contact: { select: { email: true } },
          dealId: true,
          deal: { select: { title: true } },
          ownerId: true,
          createdAt: true,
        },
      }),
    ),

  createTask: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
        type: taskTypeSchema.default('TODO'),
        priority: taskPrioritySchema.default('MEDIUM'),
        dueAt: z.date().nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        contactId: z.string().min(1).optional(),
        dealId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const task = await ctx.tenantDb.task.create({
        data: {
          id: newId('task'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          title: input.title,
          type: input.type,
          priority: input.priority,
          dueAt: input.dueAt ?? null,
          notes: input.notes ?? null,
          contactId: input.contactId,
          dealId: input.dealId,
          // New tasks are assigned to their creator by default.
          ownerId: ctx.session.user.id,
        },
      });
      await writeAudit(ctx, input.workspaceId, 'task.created', 'task', task.id);
      return { id: task.id };
    }),

  updateTask: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().trim().min(1).max(200).optional(),
        type: taskTypeSchema.optional(),
        priority: taskPrioritySchema.optional(),
        dueAt: z.date().nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const { id, ...rest } = input;
      const task = await ctx.tenantDb.task.update({
        where: { id },
        data: {
          title: rest.title,
          type: rest.type,
          priority: rest.priority,
          // dueAt and notes are nullable, so only touch them when provided.
          ...(rest.dueAt !== undefined ? { dueAt: rest.dueAt } : {}),
          ...(rest.notes !== undefined ? { notes: rest.notes } : {}),
        },
      });
      await writeAudit(ctx, task.workspaceId, 'task.updated', 'task', id);
      return { id };
    }),

  setTaskStatus: orgProcedure
    .input(z.object({ id: z.string().min(1), status: taskStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const done = input.status === 'DONE';
      const task = await ctx.tenantDb.task.update({
        where: { id: input.id },
        // Completing stamps completedAt; reopening clears it.
        data: { status: input.status, completedAt: done ? new Date() : null },
      });
      const action = done ? 'task.completed' : 'task.reopened';
      await writeAudit(ctx, task.workspaceId, action, 'task', input.id);
      if (done) {
        await emitWebhookEvent(ctx, 'task.completed', {
          id: input.id,
          title: task.title,
          workspaceId: task.workspaceId,
        });
      }
      return { id: input.id, status: input.status };
    }),

  deleteTask: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const task = await ctx.tenantDb.task.delete({ where: { id: input.id } });
      await writeAudit(ctx, task.workspaceId, 'task.deleted', 'task', input.id);
      return { id: input.id };
    }),

  // ── Notes (H2/H3): free text on a contact or a deal ────────────────────

  createNote: orgProcedure
    .input(
      z
        .object({
          workspaceId: z.string().min(1),
          contactId: z.string().min(1).optional(),
          dealId: z.string().min(1).optional(),
          body: z.string().trim().min(1).max(4000),
        })
        .refine((value) => value.contactId || value.dealId, {
          message: 'A note needs a contact or a deal',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const note = await ctx.tenantDb.note.create({
        data: {
          id: newId('note'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          dealId: input.dealId,
          authorId: ctx.session.user.id,
          body: input.body,
        },
      });
      await writeAudit(ctx, input.workspaceId, 'note.created', 'note', note.id);
      return { id: note.id };
    }),

  setNotePinned: orgProcedure
    .input(z.object({ id: z.string().min(1), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const note = await ctx.tenantDb.note.update({
        where: { id: input.id },
        data: { pinned: input.pinned },
      });
      await writeAudit(ctx, note.workspaceId, 'note.pinned', 'note', note.id);
      return { id: note.id, pinned: note.pinned };
    }),

  deleteNote: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const note = await ctx.tenantDb.note.delete({ where: { id: input.id } });
      await writeAudit(ctx, note.workspaceId, 'note.deleted', 'note', input.id);
      return { id: input.id };
    }),
});

async function writeAudit(
  ctx: OrgContext,
  workspaceId: string,
  action: string,
  targetType: string,
  targetId: string,
) {
  await ctx.tenantDb.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId: ctx.organizationId,
      workspaceId,
      actorId: ctx.session.user.id,
      action,
      targetType,
      targetId,
    },
  });
}
