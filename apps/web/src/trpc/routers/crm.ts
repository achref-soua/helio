import {
  avgCycleDays,
  newId,
  ownerLeaderboard,
  pipelineValueByStage,
  type SalesDeal,
  taskPrioritySchema,
  taskStatusSchema,
  taskTypeSchema,
  weightedForecastCents,
  winRate,
} from '@helio/core';
import { Prisma } from '@helio/db';
import { type inferProcedureBuilderResolverOptions, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authDb } from '@/lib/auth';
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
        // Optional: falls back to the organization's chosen default currency.
        currency: z.string().trim().toUpperCase().length(3).optional(),
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
      const currency =
        input.currency ??
        (
          await ctx.tenantDb.organization.findUnique({
            where: { id: ctx.organizationId },
            select: { currency: true },
          })
        )?.currency ??
        'USD';
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
          currency,
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

  /** Bulk stage move (H6): same semantics as moveDeal, one audit each. */
  moveDeals: orgProcedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(100),
        stageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const stage = await ctx.tenantDb.pipelineStage.findUnique({
        where: { id: input.stageId },
        select: { id: true, kind: true, pipelineId: true },
      });
      if (!stage) throw new TRPCError({ code: 'NOT_FOUND', message: 'Stage not found' });
      const deals = await ctx.tenantDb.deal.findMany({
        where: { id: { in: input.ids }, pipelineId: stage.pipelineId },
        select: { id: true, workspaceId: true },
      });
      for (const deal of deals) {
        await ctx.tenantDb.deal.update({
          where: { id: deal.id },
          data: {
            stageId: stage.id,
            status: stage.kind,
            closedAt: stage.kind === 'OPEN' ? null : new Date(),
          },
        });
        await writeAudit(ctx, deal.workspaceId, 'deal.moved', 'deal', deal.id, {
          bulk: true,
        });
      }
      return { moved: deals.length };
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

  /** Everything the deal detail page shows in one round-trip (H3). */
  getDeal: orgProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const deal = await ctx.tenantDb.deal.findUnique({
      where: { id: input.id },
      include: {
        stage: { select: { id: true, name: true } },
        pipeline: { select: { id: true, name: true, stages: { orderBy: { position: 'asc' } } } },
        contact: { select: { id: true, email: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        tasks: {
          select: { id: true, title: true, status: true, dueAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        notes: { orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 50 },
      },
    });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deal not found' });
    const userIds = [
      ...new Set(
        [...deal.notes.map((note) => note.authorId), deal.ownerId].filter(
          (id): id is string => !!id,
        ),
      ),
    ];
    const users = userIds.length
      ? await authDb.user
          .findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
          .catch(() => [])
      : [];
    const names = new Map(users.map((user) => [user.id, user.name || user.email]));
    return {
      ...deal,
      owner: deal.ownerId ? (names.get(deal.ownerId) ?? deal.ownerId) : null,
      notes: deal.notes.map((note) => ({
        ...note,
        author: note.authorId ? (names.get(note.authorId) ?? null) : null,
      })),
    };
  }),

  /** Org members for the owner picker — names come from the auth kernel. */
  members: orgProcedure.query(async ({ ctx }) => {
    const members = await authDb.member.findMany({
      where: { organizationId: ctx.organizationId },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });
    return members.map((member) => ({
      userId: member.userId,
      name: member.user.name || member.user.email,
    }));
  }),

  setDealOwner: orgProcedure
    .input(z.object({ id: z.string().min(1), ownerId: z.string().min(1).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const deal = await ctx.tenantDb.deal.update({
        where: { id: input.id },
        data: { ownerId: input.ownerId },
      });
      await writeAudit(ctx, deal.workspaceId, 'deal.owner_changed', 'deal', deal.id, {
        ownerId: input.ownerId,
      });
      return { id: deal.id };
    }),

  /** Close (or reopen) a deal; the loss reason lives in the audit trail. */
  setDealStatus: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        status: z.enum(['OPEN', 'WON', 'LOST']),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const deal = await ctx.tenantDb.deal.update({
        where: { id: input.id },
        data: {
          status: input.status,
          closedAt: input.status === 'OPEN' ? null : new Date(),
        },
      });
      await writeAudit(
        ctx,
        deal.workspaceId,
        input.status === 'OPEN'
          ? 'deal.reopened'
          : input.status === 'WON'
            ? 'deal.won'
            : 'deal.lost',
        'deal',
        deal.id,
        input.reason ? { reason: input.reason } : undefined,
      );
      if (input.status === 'WON' || input.status === 'LOST') {
        await emitWebhookEvent(ctx, input.status === 'WON' ? 'deal.won' : 'deal.lost', {
          id: deal.id,
          status: deal.status,
          workspaceId: deal.workspaceId,
        });
      }
      return { id: deal.id, status: deal.status };
    }),

  /** The deal's recorded history: moves, edits, closes — actor-resolved. */
  dealHistory: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.tenantDb.auditLog.findMany({
        where: { targetId: input.id, action: { startsWith: 'deal.' } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      const actorIds = [
        ...new Set(rows.map((row) => row.actorId).filter((id): id is string => !!id)),
      ];
      const users = actorIds.length
        ? await authDb.user
            .findMany({
              where: { id: { in: actorIds } },
              select: { id: true, name: true, email: true },
            })
            .catch(() => [])
        : [];
      const names = new Map(users.map((user) => [user.id, user.name || user.email]));
      return rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor: row.actorId ? (names.get(row.actorId) ?? row.actorId) : null,
        metadata: row.metadata as Record<string, unknown> | null,
        createdAt: row.createdAt,
      }));
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

  /** Sales reports (H5): pure Postgres + pure math from @helio/core. */
  salesReport: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.tenantDb.deal.findMany({
        where: { workspaceId: input.workspaceId },
        select: {
          valueCents: true,
          status: true,
          ownerId: true,
          createdAt: true,
          closedAt: true,
          currency: true,
          stage: { select: { name: true } },
        },
        take: 20_000,
      });
      const deals: SalesDeal[] = rows.map((row) => ({
        valueCents: row.valueCents,
        status: row.status,
        stageName: row.stage.name,
        ownerId: row.ownerId,
        createdAt: row.createdAt,
        closedAt: row.closedAt,
      }));
      const leaderboard = ownerLeaderboard(deals);
      const ownerIds = leaderboard
        .map((row) => row.ownerId)
        .filter((id): id is string => Boolean(id));
      const users = ownerIds.length
        ? await authDb.user.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
      const names = new Map(users.map((user) => [user.id, user.name || user.email]));
      return {
        currency: rows[0]?.currency ?? 'USD',
        totalDeals: deals.length,
        byStage: pipelineValueByStage(deals),
        winRate: winRate(deals),
        avgCycleDays: avgCycleDays(deals),
        forecastCents: weightedForecastCents(deals),
        leaderboard: leaderboard.map((row) => ({
          owner: row.ownerId ? (names.get(row.ownerId) ?? row.ownerId) : null,
          wonCents: row.wonCents,
          wonCount: row.wonCount,
        })),
      };
    }),

  // ── Companies (H4): the B2B account object ─────────────────────────────

  companies: orgProcedure
    .input(
      z.object({ workspaceId: z.string().min(1), search: z.string().trim().max(120).optional() }),
    )
    .query(({ ctx, input }) =>
      ctx.tenantDb.company.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.search
            ? { name: { contains: input.search, mode: 'insensitive' as const } }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: 200,
        include: { _count: { select: { contacts: true, deals: true } } },
      }),
    ),

  createCompany: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(160),
        domain: z.string().trim().max(160).optional(),
        industry: z.string().trim().max(120).optional(),
        website: z.string().trim().url().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      try {
        const company = await ctx.tenantDb.company.create({
          data: {
            id: newId('co'),
            organizationId: ctx.organizationId,
            workspaceId: input.workspaceId,
            name: input.name,
            domain: input.domain,
            industry: input.industry,
            website: input.website,
          },
        });
        await writeAudit(ctx, input.workspaceId, 'company.created', 'company', company.id);
        return { id: company.id };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'A company with this name exists' });
        }
        throw error;
      }
    }),

  updateCompany: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(160).optional(),
        domain: z.string().trim().max(160).nullable().optional(),
        industry: z.string().trim().max(120).nullable().optional(),
        website: z.string().trim().url().max(300).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const { id, ...rest } = input;
      const company = await ctx.tenantDb.company.update({ where: { id }, data: rest });
      await writeAudit(ctx, company.workspaceId, 'company.updated', 'company', id);
      return { id };
    }),

  deleteCompany: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const company = await ctx.tenantDb.company.delete({ where: { id: input.id } });
      await writeAudit(ctx, company.workspaceId, 'company.deleted', 'company', input.id);
      return { id: input.id };
    }),

  setContactCompany: orgProcedure
    .input(z.object({ contactId: z.string().min(1), companyId: z.string().min(1).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const contact = await ctx.tenantDb.contact.update({
        where: { id: input.contactId },
        data: { companyId: input.companyId },
      });
      await writeAudit(ctx, contact.workspaceId, 'contact.company_changed', 'contact', contact.id, {
        companyId: input.companyId,
      });
      return { id: contact.id };
    }),

  setDealCompany: orgProcedure
    .input(z.object({ dealId: z.string().min(1), companyId: z.string().min(1).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'crm:write');
      const deal = await ctx.tenantDb.deal.update({
        where: { id: input.dealId },
        data: { companyId: input.companyId },
      });
      await writeAudit(ctx, deal.workspaceId, 'deal.company_changed', 'deal', deal.id, {
        companyId: input.companyId,
      });
      return { id: deal.id };
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
  metadata?: Record<string, unknown>,
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
      metadata: metadata as never,
    },
  });
}
