import type { SupportKind } from './support';

/**
 * Turning in-app bug reports into GitHub issues. All of this is pure and
 * unit-tested: parsing the target repo, templating the issue title/body, the
 * prefilled new-issue URL (when no token is configured), and the authenticated
 * create call (with an injected `fetch`, so it stubs cleanly). The web layer
 * only resolves config and decrypts the token.
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

/** A prefilled `…/issues/new` URL — the no-token path opens this in a new tab. */
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
