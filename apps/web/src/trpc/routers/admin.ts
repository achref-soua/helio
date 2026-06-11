import { csvDocument } from '@helio/core';
import { z } from 'zod';

import { authDb } from '@/lib/auth';

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
