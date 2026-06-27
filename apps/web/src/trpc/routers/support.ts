import {
  buildSupportIssue,
  buildSupportNotificationEmail,
  createGitHubIssue,
  fetchGitHubIssue,
  type GithubRepo,
  helioVersion,
  newId,
  parseGithubRepo,
  resolveSupportRecipient,
  resolveSupportRepo,
  supportKindSchema,
  supportStatusFromIssue,
} from '@helio/core';
import { trace } from '@opentelemetry/api';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { sendMail } from '@/lib/mailer';
import { openRowSecret, sealRowSecret, vaultReady } from '@/lib/vault';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * In-app bug reports / feedback are filed automatically — no browser hand-off.
 * Every report is created as a GitHub issue (when a token is available) AND
 * emailed to a support inbox, so the team is notified like a real support desk.
 * The GitHub repo, an optional (sealed) PAT, and the notification address are an
 * admin-only setting; each falls back to a deployment default (HELIO_SUPPORT_*),
 * and the email recipient ultimately falls back to MAIL_FROM so a report is
 * never silently dropped.
 */

/** Record a non-fatal failure on the active trace (the web app has no console). */
function recordNonFatal(error: unknown) {
  trace.getActiveSpan()?.recordException(error instanceof Error ? error : new Error(String(error)));
}

/** The GitHub token for issue ops: the org's sealed PAT, else the deployment's. */
async function resolveSupportToken(
  organizationId: string,
  sealedToken: string | null | undefined,
): Promise<string | null> {
  if (sealedToken && vaultReady()) {
    return openRowSecret(organizationId, organizationId, 'supportToken', sealedToken);
  }
  return env.HELIO_SUPPORT_TOKEN ?? null;
}

/** Only re-poll GitHub for a report's status at most this often. */
const STATUS_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export const supportRouter = router({
  /** Drives the report dialog and the settings panel: target repo + recipient. */
  config: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.tenantDb.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { supportRepo: true, supportToken: true, supportEmail: true },
    });
    const repo = resolveSupportRepo(org?.supportRepo ?? null, env.HELIO_SUPPORT_REPO);
    return {
      repoSlug: `${repo.owner}/${repo.repo}`,
      // The org's own sealed token (the panel's "token set" badge).
      hasToken: Boolean(org?.supportToken) && vaultReady(),
      // Whether this org has overridden the deployment default repo / email.
      custom: Boolean(org?.supportRepo),
      customEmail: Boolean(org?.supportEmail),
      // The effective inbox a report is emailed to (org → deployment → From).
      notifyEmail: resolveSupportRecipient(
        org?.supportEmail ?? null,
        env.HELIO_SUPPORT_EMAIL,
        env.MAIL_FROM,
      ),
    };
  }),

  /** Admin-only: set the target repo, the (sealed) PAT, and/or the inbox. */
  configure: orgProcedure
    .input(
      z.object({
        // Empty string clears an override (back to the deployment default).
        repo: z.string().trim().max(120).optional(),
        // null/empty clears the token; undefined leaves it untouched.
        token: z.string().trim().max(255).nullable().optional(),
        // null/empty clears the recipient override; undefined leaves it as is.
        email: z.string().trim().max(254).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:support');
      const data: {
        supportRepo?: string | null;
        supportToken?: string | null;
        supportEmail?: string | null;
      } = {};

      if (input.repo !== undefined) {
        if (input.repo === '') {
          data.supportRepo = null;
        } else if (parseGithubRepo(input.repo)) {
          data.supportRepo = input.repo;
        } else {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Repo must be "owner/name"' });
        }
      }

      if (input.email !== undefined) {
        if (input.email === null || input.email === '') {
          data.supportEmail = null;
        } else if (z.string().email().safeParse(input.email).success) {
          data.supportEmail = input.email;
        } else {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Notification email must be a valid email address',
          });
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

  /**
   * File a report. Creates a GitHub issue (org token → deployment token) and
   * emails the support inbox; either channel succeeding is enough. Returns what
   * happened so the dialog can offer a link to the created issue.
   */
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
        select: { supportRepo: true, supportToken: true, supportEmail: true },
      });
      const repo = resolveSupportRepo(org?.supportRepo ?? null, env.HELIO_SUPPORT_REPO);
      const report = {
        kind: input.kind,
        subject: input.subject,
        body: input.body,
        pageUrl: input.url,
        reporterEmail: ctx.session.user.email,
        version: helioVersion(),
      };

      // 1) Create the GitHub issue — the org's sealed token wins, else the
      //    deployment-wide one. A failure here must not lose the report, so we
      //    record it and still fall through to the email notification.
      let issueUrl: string | null = null;
      let issueNumber: number | null = null;
      const token = await resolveSupportToken(ctx.organizationId, org?.supportToken);
      if (token) {
        try {
          const created = await createGitHubIssue(fetch, {
            token,
            repo,
            issue: buildSupportIssue(report),
          });
          issueUrl = created.url;
          issueNumber = created.number;
        } catch (error) {
          recordNonFatal(error);
        }
      }

      // 2) Notify the support inbox. The resolved recipient is always present
      //    (org → deployment → MAIL_FROM), and the org's own email identity
      //    sends it (deployment SMTP / Mailpit on any resolution failure).
      let emailed = false;
      const recipient = resolveSupportRecipient(
        org?.supportEmail ?? null,
        env.HELIO_SUPPORT_EMAIL,
        env.MAIL_FROM,
      );
      try {
        const mail = buildSupportNotificationEmail({ ...report, issueUrl });
        await sendMail({
          to: recipient,
          subject: mail.subject,
          text: mail.text,
          organizationId: ctx.organizationId,
        });
        emailed = true;
      } catch (error) {
        recordNonFatal(error);
      }

      if (!issueUrl && !emailed) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not submit your report. Please contact your administrator.',
        });
      }

      // 3) Record the report so the filer can track its status (see myReports).
      //    The issue/email already went out, so a persistence hiccup is logged,
      //    not surfaced — the submission still counts as successful.
      try {
        await ctx.tenantDb.supportReport.create({
          data: {
            id: newId('sr'),
            organizationId: ctx.organizationId,
            userId: ctx.session.user.id,
            kind: input.kind,
            subject: input.subject,
            issueNumber,
            issueUrl,
          },
        });
      } catch (error) {
        recordNonFatal(error);
      }

      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'support.reported',
        targetType: 'organization',
        targetId: ctx.organizationId,
        metadata: { issue: issueNumber, emailed },
      });
      return { created: Boolean(issueUrl), url: issueUrl, emailed };
    }),

  /**
   * The reports the current user filed, newest first, with their live status.
   * Issue-backed reports are re-synced from GitHub (open → SUBMITTED, closed →
   * RESOLVED/DECLINED) at most every {@link STATUS_SYNC_INTERVAL_MS}; without a
   * token (email-only deployments) they stay SUBMITTED. The dashboard pairs this
   * with `updates.check` to nudge "a fix shipped — update to install it".
   */
  myReports: orgProcedure.query(async ({ ctx }) => {
    const reports = await ctx.tenantDb.supportReport.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    // Re-sync the issue-backed, not-recently-synced reports from GitHub. One
    // GET per stale report (a user has a handful); failures leave status as-is.
    const now = Date.now();
    const stale = reports.filter(
      (r) =>
        r.issueNumber !== null &&
        (r.syncedAt === null || now - r.syncedAt.getTime() > STATUS_SYNC_INTERVAL_MS),
    );
    if (stale.length > 0) {
      const org = await ctx.tenantDb.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { supportRepo: true, supportToken: true },
      });
      const token = await resolveSupportToken(ctx.organizationId, org?.supportToken);
      if (token) {
        let repo: GithubRepo | null = null;
        try {
          repo = resolveSupportRepo(org?.supportRepo ?? null, env.HELIO_SUPPORT_REPO);
        } catch (error) {
          recordNonFatal(error);
        }
        if (repo) {
          for (const report of stale) {
            const issue = await fetchGitHubIssue(fetch, {
              token,
              repo,
              number: report.issueNumber!,
            });
            if (!issue) continue;
            const status = supportStatusFromIssue(issue.state, issue.stateReason);
            const resolvedAt =
              status === 'RESOLVED' ? (report.resolvedAt ?? new Date()) : report.resolvedAt;
            await ctx.tenantDb.supportReport.update({
              where: { id: report.id },
              data: { status, resolvedAt, syncedAt: new Date() },
            });
            report.status = status;
            report.resolvedAt = resolvedAt;
          }
        }
      }
    }

    return reports.map((report) => ({
      id: report.id,
      kind: report.kind,
      subject: report.subject,
      status: report.status,
      issueUrl: report.issueUrl,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
    }));
  }),
});
