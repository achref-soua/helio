import {
  countByDay,
  csvDocument,
  dayKeys,
  mergeDailySeries,
  newId,
  STUDIO_MODELS,
  studioModel,
  validateStudioWrite,
} from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';
import { authDb } from '@/lib/auth';
import { getClickHouse } from '@/lib/clickhouse';
import { collectSystemHealth } from '@/lib/system-health';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * The admin area's data plane (G3+). Reads only — every row it shows was
 * written by the feature that performed the action. Actor names come from
 * the auth kernel, because the RLS tenant role is deliberately denied
 * identity tables.
 */

const auditFilters = z.object({
  action: z.string().trim().max(100).optional(),
  targetType: z.string().trim().max(50).optional(),
  actor: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

type AuditFilters = z.infer<typeof auditFilters>;

async function actorIdsMatching(actor: string): Promise<string[]> {
  const users = await authDb.user.findMany({
    where: {
      OR: [
        { email: { contains: actor, mode: 'insensitive' } },
        { name: { contains: actor, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: 50,
  });
  return users.map((user) => user.id);
}

function auditWhere(filters: AuditFilters, actorIds: string[] | null) {
  return {
    ...(filters.action ? { action: { startsWith: filters.action } } : {}),
    ...(filters.targetType ? { targetType: filters.targetType } : {}),
    ...(actorIds ? { actorId: { in: actorIds } } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };
}

interface StudioDelegate {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Registry-checked dynamic access to the RLS-scoped client. */
function studioDelegate(tenantDb: unknown, name: string): StudioDelegate {
  return (tenantDb as Record<string, StudioDelegate>)[name]!;
}

async function actorNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const distinct = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (distinct.length === 0) return new Map();
  const users = await authDb.user.findMany({
    where: { id: { in: distinct } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user.name || user.email]));
}

export const adminRouter = router({
  auditList: orgProcedure
    .input(auditFilters.extend({ cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:audit');
      const actorIds = input.actor ? await actorIdsMatching(input.actor) : null;
      const rows = await ctx.tenantDb.auditLog.findMany({
        where: auditWhere(input, actorIds),
        orderBy: { createdAt: 'desc' },
        take: 51,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, 50);
      const names = await actorNames(page.map((row) => row.actorId));
      return {
        entries: page.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          actor: row.actorId ? (names.get(row.actorId) ?? row.actorId) : null,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: row.metadata as Record<string, unknown> | null,
        })),
        nextCursor: rows.length > 50 ? rows[50]!.id : null,
      };
    }),

  /**
   * Org-wide send volume and contact growth as dense daily series.
   * Postgres-only — these numbers exist without the analytics store.
   * Row scans are capped; an org past the cap sees the most recent window
   * (honest for a dashboard; N2 revisits with SQL aggregation if needed).
   */
  reportActivity: orgProcedure
    .input(z.object({ days: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(30) }))
    .query(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:reports');
      const since = new Date(Date.now() - input.days * 86_400_000);
      const [emailSends, inAppDeliveries, contacts] = await Promise.all([
        ctx.tenantDb.emailSend.findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true },
          take: 20_000,
        }),
        ctx.tenantDb.inAppDelivery.findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true },
          take: 20_000,
        }),
        ctx.tenantDb.contact.findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true },
          take: 20_000,
        }),
      ]);
      const keys = dayKeys(input.days);
      return {
        sends: mergeDailySeries(keys, {
          email: countByDay(emailSends.map((row) => row.createdAt)),
          inApp: countByDay(inAppDeliveries.map((row) => row.createdAt)),
        }),
        contactGrowth: mergeDailySeries(keys, {
          contacts: countByDay(contacts.map((row) => row.createdAt)),
        }),
      };
    }),

  /** Journey outcomes: runs per journey by status (pure Postgres). */
  reportJourneys: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:reports');
    const [grouped, journeys] = await Promise.all([
      ctx.tenantDb.journeyRun.groupBy({
        by: ['journeyId', 'status'],
        _count: { _all: true },
      }),
      ctx.tenantDb.journey.findMany({ select: { id: true, name: true } }),
    ]);
    const names = new Map(journeys.map((journey) => [journey.id, journey.name]));
    const rows = new Map<
      string,
      { journey: string; running: number; completed: number; failed: number }
    >();
    for (const entry of grouped) {
      const row = rows.get(entry.journeyId) ?? {
        journey: names.get(entry.journeyId) ?? entry.journeyId,
        running: 0,
        completed: 0,
        failed: 0,
      };
      if (entry.status === 'RUNNING') row.running += entry._count._all;
      else if (entry.status === 'COMPLETED') row.completed += entry._count._all;
      else row.failed += entry._count._all;
      rows.set(entry.journeyId, row);
    }
    return [...rows.values()].sort(
      (a, b) => b.running + b.completed + b.failed - (a.running + a.completed + a.failed),
    );
  }),

  /**
   * Top campaigns by sends (Postgres) with open/click engagement when the
   * analytics store is reachable — the proven degrade pattern.
   */
  reportCampaigns: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:reports');
    const grouped = await ctx.tenantDb.emailSend.groupBy({
      by: ['campaignId'],
      where: { campaignId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { campaignId: 'desc' } },
      take: 10,
    });
    const ids = grouped.map((entry) => entry.campaignId).filter((id): id is string => Boolean(id));
    const campaigns = await ctx.tenantDb.campaign.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));

    let clickhouseUp = true;
    const engagement = new Map<string, { opens: number; clicks: number }>();
    try {
      const workspaces = await ctx.tenantDb.workspace.findMany({ select: { id: true } });
      const result = await getClickHouse().query({
        query: `
          SELECT
            JSONExtractString(properties, 'campaignId') AS campaign_id,
            countIf(event = 'Email Opened') AS opens,
            countIf(event = 'Email Clicked') AS clicks
          FROM events
          WHERE workspace_id IN {workspaceIds:Array(String)}
            AND campaign_id != ''
          GROUP BY campaign_id`,
        query_params: { workspaceIds: workspaces.map((workspace) => workspace.id) },
        format: 'JSON',
      });
      const body = (await result.json()) as {
        data: Array<{ campaign_id: string; opens: string; clicks: string }>;
      };
      for (const row of body.data) {
        engagement.set(row.campaign_id, { opens: Number(row.opens), clicks: Number(row.clicks) });
      }
    } catch {
      clickhouseUp = false;
    }

    return {
      clickhouseUp,
      rows: grouped.map((entry) => ({
        campaign: names.get(entry.campaignId ?? '') ?? (entry.campaignId || '—'),
        sends: entry._count._all,
        opens: engagement.get(entry.campaignId ?? '')?.opens ?? null,
        clicks: engagement.get(entry.campaignId ?? '')?.clicks ?? null,
      })),
    };
  }),

  /** Who has been doing what: audit actions per member, last 30 days. */
  reportMembers: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:reports');
    const since = new Date(Date.now() - 30 * 86_400_000);
    const grouped = await ctx.tenantDb.auditLog.groupBy({
      by: ['actorId'],
      where: { createdAt: { gte: since }, actorId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { actorId: 'desc' } },
      take: 10,
    });
    const names = await actorNames(grouped.map((entry) => entry.actorId));
    return grouped.map((entry) => ({
      member: entry.actorId ? (names.get(entry.actorId) ?? entry.actorId) : 'system',
      actions: entry._count._all,
    }));
  }),

  /** Service + store reachability, backup staleness, config trouble spots. */
  health: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:health');
    const [system, latestBackup, failedModels, failedCredentials] = await Promise.all([
      collectSystemHealth(),
      ctx.appDb.backupRun
        .findFirst({ where: { status: 'OK' }, orderBy: { startedAt: 'desc' } })
        .catch(() => null),
      ctx.tenantDb.churnModel.count({ where: { status: 'FAILED' } }),
      ctx.tenantDb.providerCredential.count({ where: { status: 'FAILED' } }),
    ]);
    const backupAgeHours = latestBackup
      ? Math.floor((Date.now() - latestBackup.startedAt.getTime()) / 3_600_000)
      : null;
    return {
      ...system,
      backup: {
        lastOkAgeHours: backupAgeHours,
        stale: backupAgeHours === null || backupAgeHours > 36,
      },
      failedModels,
      failedCredentials,
    };
  }),

  alertsList: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:health');
    const [alerts, unread] = await Promise.all([
      ctx.tenantDb.systemAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      ctx.tenantDb.systemAlert.count({ where: { readAt: null } }),
    ]);
    return {
      unread,
      alerts: alerts.map((alert) => ({
        id: alert.id,
        kind: alert.kind,
        message: alert.message,
        readAt: alert.readAt,
        createdAt: alert.createdAt,
      })),
    };
  }),

  alertsMarkRead: orgProcedure
    .input(z.object({ id: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:health');
      await ctx.tenantDb.systemAlert.updateMany({
        where: { readAt: null, ...(input.id ? { id: input.id } : {}) },
        data: { readAt: new Date() },
      });
      return { ok: true };
    }),

  // ── Database Studio (J): allow-listed, RLS-scoped, audited CRUD ────────

  dbTables: orgProcedure.query(({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:database');
    return STUDIO_MODELS.map((model) => ({
      name: model.name,
      label: model.label,
      creatable: model.creatable,
      fields: model.fields,
    }));
  }),

  dbRows: orgProcedure
    .input(
      z.object({
        model: z.string().min(1),
        workspaceId: z.string().min(1),
        search: z.string().trim().max(200).optional(),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:database');
      const spec = studioModel(input.model);
      if (!spec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown table' });
      const delegate = studioDelegate(ctx.tenantDb, spec.name);
      const rows = (await delegate.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.search && spec.searchField
            ? { [spec.searchField]: { contains: input.search, mode: 'insensitive' } }
            : {}),
        },
        orderBy: { id: 'desc' },
        take: 51,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      })) as Array<Record<string, unknown>>;
      const page = rows.slice(0, 50);
      return {
        rows: page.map((row) =>
          Object.fromEntries(spec.fields.map((field) => [field.name, row[field.name] ?? null])),
        ),
        nextCursor: rows.length > 50 ? String(rows[50]!.id) : null,
      };
    }),

  dbUpdateRow: orgProcedure
    .input(
      z.object({
        model: z.string().min(1),
        id: z.string().min(1),
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:database');
      const spec = studioModel(input.model);
      if (!spec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown table' });
      const checked = validateStudioWrite(spec, input.values);
      if (!checked.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: checked.error });
      const delegate = studioDelegate(ctx.tenantDb, spec.name);
      const row = (await delegate.update({
        where: { id: input.id },
        data: checked.data,
      })) as Record<string, unknown>;
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'dbstudio.row_updated',
        targetType: spec.name,
        targetId: input.id,
        metadata: { fields: Object.keys(checked.data) },
      });
      return { id: String(row.id) };
    }),

  dbCreateRow: orgProcedure
    .input(
      z.object({
        model: z.string().min(1),
        workspaceId: z.string().min(1),
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:database');
      const spec = studioModel(input.model);
      if (!spec?.creatable) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This table is not creatable here' });
      }
      const checked = validateStudioWrite(spec, input.values);
      if (!checked.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: checked.error });
      for (const field of spec.fields) {
        if (field.required && checked.data[field.name] === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${field.name} is required` });
        }
      }
      const delegate = studioDelegate(ctx.tenantDb, spec.name);
      const row = (await delegate.create({
        data: {
          id: newId('row'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          ...checked.data,
        },
      })) as Record<string, unknown>;
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'dbstudio.row_created',
        targetType: spec.name,
        targetId: String(row.id),
        metadata: { fields: Object.keys(checked.data) },
      });
      return { id: String(row.id) };
    }),

  /** Deletes are owner-only and confirmed by typed word client-side. */
  dbDeleteRow: orgProcedure
    .input(z.object({ model: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:backups');
      const spec = studioModel(input.model);
      if (!spec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown table' });
      const delegate = studioDelegate(ctx.tenantDb, spec.name);
      await delegate.delete({ where: { id: input.id } });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'dbstudio.row_deleted',
        targetType: spec.name,
        targetId: input.id,
      });
      return { ok: true };
    }),

  auditExportCsv: orgProcedure.input(auditFilters).mutation(async ({ ctx, input }) => {
    requirePermission(ctx.memberRole, 'admin:audit');
    const actorIds = input.actor ? await actorIdsMatching(input.actor) : null;
    const rows = await ctx.tenantDb.auditLog.findMany({
      where: auditWhere(input, actorIds),
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const names = await actorNames(rows.map((row) => row.actorId));
    return {
      csv: csvDocument(
        ['time', 'actor', 'action', 'target_type', 'target_id', 'metadata'],
        rows.map((row) => [
          row.createdAt.toISOString(),
          row.actorId ? (names.get(row.actorId) ?? row.actorId) : '',
          row.action,
          row.targetType ?? '',
          row.targetId ?? '',
          row.metadata ? JSON.stringify(row.metadata) : '',
        ]),
      ),
      truncated: rows.length === 1000,
    };
  }),
});
