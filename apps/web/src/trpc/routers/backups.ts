import { newId } from '@helio/core';
import { TRPCError } from '@trpc/server';

import { env } from '@/lib/env';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * Local backup visibility (ADR-0020). The tables are instance-level —
 * the sidecar writes them on the admin role; the app role has read
 * access to runs and insert on the run-now queue. Owner-gated, and only
 * meaningful where the panel is enabled (the self-host bundle).
 */

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function requirePanel() {
  if (!env.BACKUPS_PANEL_ENABLED) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The backups panel is not enabled on this deployment (BACKUPS_PANEL_ENABLED)',
    });
  }
}

export const backupsRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:backups');
    if (!env.BACKUPS_PANEL_ENABLED) return { enabled: false as const, stale: false, runs: [] };
    const rows = await ctx.tenantDb.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
    const lastOk = rows.find((row) => row.status === 'OK');
    const stale = !lastOk || Date.now() - lastOk.startedAt.getTime() > STALE_AFTER_MS;
    return {
      enabled: true as const,
      stale,
      runs: rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        label: row.label,
        status: row.status,
        sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
        encrypted: row.encrypted,
        appVersion: row.appVersion,
        startedAt: row.startedAt.toISOString(),
        error: row.error,
      })),
    };
  }),

  /** Queue a run-now; the sidecar's 15s poll picks it up. */
  runNow: orgProcedure.mutation(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'admin:backups');
    requirePanel();
    await ctx.tenantDb.backupRequest.create({
      data: { id: newId('bkr'), label: 'dashboard' },
    });
    return { queued: true };
  }),
});
