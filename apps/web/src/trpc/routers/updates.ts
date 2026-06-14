import { can, helioVersion, isNewerHelioVersion } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { readUpdateStatus, writeUpdateRequest } from '@/lib/updates';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * Settings → Updates. `check` compares the running build against GitHub's
 * latest release (cached, anonymous — same probe as the About panel).
 * `status` reads the updater sidecar's job file and is the only thing the
 * dashboard polls during an update (no GitHub call on the hot path). `start`
 * is owner-only and merely drops a secret-guarded request for the sidecar —
 * the dashboard never touches the Docker socket.
 */

const REPO = 'achref-soua/helio';
const VERSION_RE = /^v?\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/;

async function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      // Cached briefly: keeps "Check" feeling live without hammering GitHub's
      // unauthenticated rate limit when several admins look at once.
      next: { revalidate: 60 },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as { tag_name?: string; html_url?: string };
    return release.tag_name && release.html_url
      ? { version: release.tag_name, url: release.html_url }
      : null;
  } catch {
    return null;
  }
}

function inAppReady(): boolean {
  return env.HELIO_INAPP_UPDATE && Boolean(env.HELIO_UPDATE_SECRET);
}

export const updatesRouter = router({
  /** Current build, latest release, and whether this user may one-click it. */
  check: orgProcedure.query(async ({ ctx }) => {
    const currentVersion = helioVersion();
    // A source checkout ("dev") has nothing to compare against, and
    // HELIO_UPDATE_CHECK=false opts out of the releases probe entirely.
    const mayCheck = currentVersion !== 'dev' && process.env.HELIO_UPDATE_CHECK !== 'false';
    const latest = mayCheck ? await fetchLatestRelease() : null;
    const updateAvailable = latest ? isNewerHelioVersion(latest.version, currentVersion) : false;
    return {
      currentVersion,
      latest,
      updateAvailable,
      inAppEnabled: inAppReady(),
      canUpdate: inAppReady() && can(ctx.memberRole, 'admin:updates'),
    };
  }),

  /** The current update job (sidecar status file only — polled, no network). */
  status: orgProcedure.query(() => {
    return { job: inAppReady() ? readUpdateStatus(env.HELIO_UPDATE_STATE_DIR) : null };
  }),

  /** Owner-only: queue an update for the sidecar to perform. */
  start: orgProcedure
    .input(z.object({ target: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'admin:updates');
      if (!inAppReady()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'In-app updates are not enabled on this deployment.',
        });
      }
      const target = input.target?.trim() || undefined;
      if (target && !VERSION_RE.test(target)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid version: ${target}` });
      }
      writeUpdateRequest({
        stateDir: env.HELIO_UPDATE_STATE_DIR,
        secret: env.HELIO_UPDATE_SECRET!,
        target,
      });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'update.requested',
        targetType: 'instance',
        metadata: target ? { target } : undefined,
      });
      return { queued: true, target: target ?? null };
    }),
});
