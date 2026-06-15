import {
  buildSupportIssue,
  createGitHubIssue,
  githubNewIssueUrl,
  helioVersion,
  parseGithubRepo,
  supportKindSchema,
} from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { openRowSecret, sealRowSecret, vaultReady } from '@/lib/vault';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * Bug reports / feedback go to GitHub, not an in-app inbox. Any member files a
 * report; with a configured PAT it is created server-side as an issue, otherwise
 * the dashboard opens a prefilled new-issue page. The target repo and optional
 * (sealed) token are an admin-only setting; the repo falls back to
 * HELIO_SUPPORT_REPO (the upstream repo) when unset.
 */

/** The effective repo for an org: its own, else the deployment default. */
function resolveRepo(orgRepo: string | null) {
  return parseGithubRepo(orgRepo) ?? parseGithubRepo(env.HELIO_SUPPORT_REPO)!;
}

export const supportRouter = router({
  /** Drives the report dialog: which repo, whether to create server-side. */
  config: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.tenantDb.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { supportRepo: true, supportToken: true },
    });
    const repo = resolveRepo(org?.supportRepo ?? null);
    return {
      owner: repo.owner,
      repo: repo.repo,
      repoSlug: `${repo.owner}/${repo.repo}`,
      hasToken: Boolean(org?.supportToken) && vaultReady(),
      // Whether this org has overridden the deployment default repo.
      custom: Boolean(org?.supportRepo),
      version: helioVersion(),
      reporterEmail: ctx.session.user.email ?? null,
    };
  }),

  /** Admin-only: set the target repo and/or the (sealed) PAT. */
  configure: orgProcedure
    .input(
      z.object({
        // Empty string clears the override (back to the deployment default).
        repo: z.string().trim().max(120).optional(),
        // null clears the token; undefined leaves it untouched.
        token: z.string().trim().max(255).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:support');
      const data: { supportRepo?: string | null; supportToken?: string | null } = {};

      if (input.repo !== undefined) {
        if (input.repo === '') {
          data.supportRepo = null;
        } else if (parseGithubRepo(input.repo)) {
          data.supportRepo = input.repo;
        } else {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Repo must be "owner/name"' });
        }
      }

      if (input.token !== undefined) {
        if (input.token === null || input.token === '') {
          data.supportToken = null;
        } else if (!vaultReady()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'HELIO_ENCRYPTION_KEY is not configured, so a token cannot be stored',
          });
        } else {
          data.supportToken = await sealRowSecret(
            ctx.organizationId,
            ctx.organizationId,
            'supportToken',
            input.token,
          );
        }
      }

      await ctx.tenantDb.organization.update({ where: { id: ctx.organizationId }, data });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'support.configured',
        targetType: 'organization',
        targetId: ctx.organizationId,
      });
      return { ok: true };
    }),

  /** File a report. With a token, creates the issue and returns its URL. */
  report: orgProcedure
    .input(
      z.object({
        kind: supportKindSchema.default('BUG'),
        subject: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(5000),
        url: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.tenantDb.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { supportRepo: true, supportToken: true },
      });
      const repo = resolveRepo(org?.supportRepo ?? null);
      const issue = buildSupportIssue({
        kind: input.kind,
        subject: input.subject,
        body: input.body,
        pageUrl: input.url,
        reporterEmail: ctx.session.user.email,
        version: helioVersion(),
      });

      // No token → hand back a prefilled new-issue URL for the client to open.
      if (!org?.supportToken || !vaultReady()) {
        return { created: false as const, url: githubNewIssueUrl(repo, issue) };
      }

      const token = await openRowSecret(
        ctx.organizationId,
        ctx.organizationId,
        'supportToken',
        org.supportToken,
      );
      const result = await createGitHubIssue(fetch, { token, repo, issue });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'support.reported',
        targetType: 'organization',
        targetId: ctx.organizationId,
        metadata: { issue: result.number },
      });
      return { created: true as const, url: result.url };
    }),
});
