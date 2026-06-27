import type { SupportKind } from './support';

/**
 * Turning in-app bug reports into GitHub issues and a support notification
 * email. All of this is pure and unit-tested: resolving the target repo and
 * notification recipient, templating the issue title/body and the email, the
 * prefilled new-issue URL, and the authenticated create call (with an injected
 * `fetch`, so it stubs cleanly). The web layer only reads config, decrypts the
 * token, and sends the mail.
 */

export interface GithubRepo {
  owner: string;
  repo: string;
}

/** Parse `owner/name` into its parts, or null if it is not a valid GitHub repo. */
export function parseGithubRepo(input: string | null | undefined): GithubRepo | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, '');
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(trimmed);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/, '') };
}

/**
 * The effective target repo for an org: its own override, else the deployment
 * default (`HELIO_SUPPORT_REPO`). Throws if neither is a valid `owner/name` —
 * the deployment default is validated at startup, so in practice this resolves.
 */
export function resolveSupportRepo(
  orgRepo: string | null | undefined,
  deploymentRepo: string | null | undefined,
): GithubRepo {
  const repo = parseGithubRepo(orgRepo) ?? parseGithubRepo(deploymentRepo);
  if (!repo) {
    throw new Error('No valid support repository configured (set HELIO_SUPPORT_REPO)');
  }
  return repo;
}

/**
 * Who a support notification is emailed to: the org's own inbox, else the
 * deployment-wide one (`HELIO_SUPPORT_EMAIL`), else the deployment's own From
 * identity (`MAIL_FROM`) as a last resort — so a report is never silently
 * dropped (in dev that lands in Mailpit).
 */
export function resolveSupportRecipient(
  orgEmail: string | null | undefined,
  deploymentEmail: string | null | undefined,
  fallbackFrom: string,
): string {
  return orgEmail?.trim() || deploymentEmail?.trim() || fallbackFrom;
}

/** The label(s) for a report kind: a bug stays `bug`, the rest are enhancements. */
export function supportIssueLabels(kind: SupportKind): string[] {
  return kind === 'BUG' ? ['bug'] : ['enhancement'];
}

export interface SupportReportInput {
  kind: SupportKind;
  subject: string;
  body: string;
  pageUrl?: string | null;
  reporterEmail?: string | null;
  version?: string | null;
}

export interface SupportIssue {
  title: string;
  body: string;
  labels: string[];
}

/** Template a report into a GitHub issue title/body/labels. */
export function buildSupportIssue(input: SupportReportInput): SupportIssue {
  const kindLabel = input.kind.charAt(0) + input.kind.slice(1).toLowerCase();
  const context = [
    '',
    '---',
    `- Kind: ${kindLabel}`,
    input.pageUrl ? `- Page: ${input.pageUrl}` : null,
    input.reporterEmail ? `- Reporter: ${input.reporterEmail}` : null,
    input.version ? `- Helio version: ${input.version}` : null,
    '',
    '_Filed from the Helio dashboard._',
  ]
    .filter((line) => line !== null)
    .join('\n');
  return {
    title: input.subject.trim(),
    body: `${input.body.trim()}\n${context}`,
    labels: supportIssueLabels(input.kind),
  };
}

export interface SupportNotification {
  subject: string;
  text: string;
}

/**
 * Template a report into a plain-text notification email for the support inbox.
 * Mirrors the issue's context block and links the created GitHub issue when one
 * exists. Pure: the web layer resolves the recipient and sends it through the
 * org's email identity (Mailpit in dev).
 */
export function buildSupportNotificationEmail(
  input: SupportReportInput & { issueUrl?: string | null },
): SupportNotification {
  const kindLabel = input.kind.charAt(0) + input.kind.slice(1).toLowerCase();
  const lines = [
    input.body.trim(),
    '',
    '---',
    `Kind: ${kindLabel}`,
    input.reporterEmail ? `Reporter: ${input.reporterEmail}` : null,
    input.pageUrl ? `Page: ${input.pageUrl}` : null,
    input.version ? `Helio version: ${input.version}` : null,
    input.issueUrl ? `GitHub issue: ${input.issueUrl}` : null,
  ].filter((line): line is string => line !== null);
  return {
    subject: `[Helio] ${kindLabel}: ${input.subject.trim()}`,
    text: lines.join('\n'),
  };
}

/** A prefilled `…/issues/new` URL — used as the last-resort manual fallback. */
export function githubNewIssueUrl(repo: GithubRepo, issue: SupportIssue): string {
  const params = new URLSearchParams({
    title: issue.title,
    body: issue.body,
    labels: issue.labels.join(','),
  });
  return `https://github.com/${repo.owner}/${repo.repo}/issues/new?${params.toString()}`;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Create an issue via the GitHub REST API with a PAT. `fetchImpl` is injected so
 * the call is testable without a network; throws with the API's message on a
 * non-2xx response.
 */
export async function createGitHubIssue(
  fetchImpl: FetchLike,
  args: { token: string; repo: GithubRepo; issue: SupportIssue },
): Promise<{ url: string; number: number }> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${args.repo.owner}/${args.repo.repo}/issues`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${args.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        title: args.issue.title,
        body: args.issue.body,
        labels: args.issue.labels,
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      `GitHub issue creation failed (${response.status})${detail?.message ? `: ${detail.message}` : ''}`,
    );
  }
  const created = (await response.json()) as { html_url?: string; number?: number };
  if (!created.html_url || typeof created.number !== 'number') {
    throw new Error('GitHub returned an unexpected response');
  }
  return { url: created.html_url, number: created.number };
}

/** The status a filer sees for their report, derived from its GitHub issue. */
export type SupportReportStatus = 'SUBMITTED' | 'RESOLVED' | 'DECLINED';

export interface GithubIssueState {
  state: 'open' | 'closed';
  /** GitHub's close reason: 'completed' | 'not_planned' | 'reopened' | null. */
  stateReason: string | null;
  url: string;
}

/**
 * Map a GitHub issue's state to the status a filer sees. An open issue is still
 * SUBMITTED; a closed-as-not-planned is DECLINED; any other close (completed, or
 * a close with no reason) is RESOLVED — the owner fixed it.
 */
export function supportStatusFromIssue(
  state: 'open' | 'closed',
  stateReason: string | null,
): SupportReportStatus {
  if (state !== 'closed') return 'SUBMITTED';
  return stateReason === 'not_planned' ? 'DECLINED' : 'RESOLVED';
}

/**
 * Read a single issue's open/closed state via the GitHub REST API (injected
 * `fetch`, so it stubs cleanly). Returns null when the issue is gone (404) or
 * the API errors — the caller leaves the report's status unchanged.
 */
export async function fetchGitHubIssue(
  fetchImpl: FetchLike,
  args: { token: string; repo: GithubRepo; number: number },
): Promise<GithubIssueState | null> {
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${args.repo.owner}/${args.repo.repo}/issues/${args.number}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${args.token}`,
          'x-github-api-version': '2022-11-28',
        },
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const issue = (await response.json().catch(() => null)) as {
    state?: string;
    state_reason?: string | null;
    html_url?: string;
  } | null;
  if (!issue || (issue.state !== 'open' && issue.state !== 'closed') || !issue.html_url) {
    return null;
  }
  return { state: issue.state, stateReason: issue.state_reason ?? null, url: issue.html_url };
}
