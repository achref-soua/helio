import { describe, expect, it, vi } from 'vitest';

import {
  buildSupportIssue,
  buildSupportNotificationEmail,
  createGitHubIssue,
  fetchGitHubIssue,
  githubNewIssueUrl,
  parseGithubRepo,
  resolveSupportRecipient,
  resolveSupportRepo,
  supportIssueLabels,
  supportStatusFromIssue,
} from './github-support';

describe('parseGithubRepo', () => {
  it('parses owner/name', () => {
    expect(parseGithubRepo('achref-soua/helio')).toEqual({ owner: 'achref-soua', repo: 'helio' });
  });

  it('accepts a full github URL and strips a .git suffix', () => {
    expect(parseGithubRepo('https://github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('rejects malformed input', () => {
    expect(parseGithubRepo('')).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
    expect(parseGithubRepo('no-slash')).toBeNull();
    expect(parseGithubRepo('a/b/c')).toBeNull();
    expect(parseGithubRepo('bad owner/name')).toBeNull();
  });
});

describe('resolveSupportRepo', () => {
  it('prefers the org override, falling back to the deployment default', () => {
    expect(resolveSupportRepo('acme/widgets', 'achref-soua/helio')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
    expect(resolveSupportRepo(null, 'achref-soua/helio')).toEqual({
      owner: 'achref-soua',
      repo: 'helio',
    });
    // A blank/garbage org value falls through to the deployment default.
    expect(resolveSupportRepo('not a repo', 'achref-soua/helio')).toEqual({
      owner: 'achref-soua',
      repo: 'helio',
    });
  });

  it('throws when neither is a valid repo', () => {
    expect(() => resolveSupportRepo(null, null)).toThrow(/HELIO_SUPPORT_REPO/);
  });
});

describe('resolveSupportRecipient', () => {
  it('prefers the org inbox, then the deployment one, then the From identity', () => {
    expect(
      resolveSupportRecipient('team@acme.com', 'support@helio.app', 'no-reply@helio.local'),
    ).toBe('team@acme.com');
    expect(resolveSupportRecipient(null, 'support@helio.app', 'no-reply@helio.local')).toBe(
      'support@helio.app',
    );
    expect(resolveSupportRecipient('   ', '', 'no-reply@helio.local')).toBe('no-reply@helio.local');
  });
});

describe('buildSupportNotificationEmail', () => {
  it('templates a subject and a context block, linking the issue when present', () => {
    const mail = buildSupportNotificationEmail({
      kind: 'BUG',
      subject: '  Broken export  ',
      body: '  CSV export 500s  ',
      pageUrl: '/contacts',
      reporterEmail: 'ada@example.com',
      version: '2.0.7',
      issueUrl: 'https://github.com/acme/widgets/issues/7',
    });
    expect(mail.subject).toBe('[Helio] Bug: Broken export');
    expect(mail.text).toContain('CSV export 500s');
    expect(mail.text).toContain('Kind: Bug');
    expect(mail.text).toContain('Reporter: ada@example.com');
    expect(mail.text).toContain('Page: /contacts');
    expect(mail.text).toContain('Helio version: 2.0.7');
    expect(mail.text).toContain('GitHub issue: https://github.com/acme/widgets/issues/7');
  });

  it('omits context lines (and the issue link) that are not provided', () => {
    const mail = buildSupportNotificationEmail({
      kind: 'FEEDBACK',
      subject: 'Nice',
      body: 'Love it',
    });
    expect(mail.subject).toBe('[Helio] Feedback: Nice');
    expect(mail.text).not.toContain('Reporter:');
    expect(mail.text).not.toContain('Page:');
    expect(mail.text).not.toContain('GitHub issue:');
  });
});

describe('supportIssueLabels', () => {
  it('labels bugs as bug and everything else as enhancement', () => {
    expect(supportIssueLabels('BUG')).toEqual(['bug']);
    expect(supportIssueLabels('FEEDBACK')).toEqual(['enhancement']);
    expect(supportIssueLabels('QUESTION')).toEqual(['enhancement']);
  });
});

describe('buildSupportIssue', () => {
  it('templates the title, body, context, and labels', () => {
    const issue = buildSupportIssue({
      kind: 'BUG',
      subject: '  Broken export  ',
      body: '  CSV export 500s  ',
      pageUrl: '/contacts',
      reporterEmail: 'ada@example.com',
      version: '2.0.7',
    });
    expect(issue.title).toBe('Broken export');
    expect(issue.body).toContain('CSV export 500s');
    expect(issue.body).toContain('- Kind: Bug');
    expect(issue.body).toContain('- Page: /contacts');
    expect(issue.body).toContain('- Reporter: ada@example.com');
    expect(issue.body).toContain('- Helio version: 2.0.7');
    expect(issue.labels).toEqual(['bug']);
  });

  it('omits context lines that are not provided', () => {
    const issue = buildSupportIssue({ kind: 'FEEDBACK', subject: 'Nice', body: 'Love it' });
    expect(issue.body).not.toContain('- Page:');
    expect(issue.body).not.toContain('- Reporter:');
    expect(issue.labels).toEqual(['enhancement']);
  });
});

describe('githubNewIssueUrl', () => {
  it('builds a prefilled new-issue URL with encoded params', () => {
    const url = githubNewIssueUrl(
      { owner: 'acme', repo: 'widgets' },
      { title: 'A & B', body: 'line', labels: ['bug', 'enhancement'] },
    );
    expect(url.startsWith('https://github.com/acme/widgets/issues/new?')).toBe(true);
    expect(url).toContain('title=A+%26+B');
    expect(url).toContain('labels=bug%2Cenhancement');
  });
});

describe('createGitHubIssue', () => {
  const repo = { owner: 'acme', repo: 'widgets' };
  const issue = { title: 'T', body: 'B', labels: ['bug'] };

  it('posts to the issues API and returns the issue URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: 'https://github.com/acme/widgets/issues/7', number: 7 }),
    } as Response);
    const result = await createGitHubIssue(fetchImpl, { token: 'ghp_x', repo, issue });
    expect(result).toEqual({ url: 'https://github.com/acme/widgets/issues/7', number: 7 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/acme/widgets/issues');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_x');
  });

  it('throws with the API message on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Bad credentials' }),
    } as Response);
    await expect(createGitHubIssue(fetchImpl, { token: 'bad', repo, issue })).rejects.toThrow(
      /401.*Bad credentials/,
    );
  });
});

describe('supportStatusFromIssue', () => {
  it('keeps an open issue SUBMITTED', () => {
    expect(supportStatusFromIssue('open', null)).toBe('SUBMITTED');
  });

  it('maps a closed-completed (or reasonless close) issue to RESOLVED', () => {
    expect(supportStatusFromIssue('closed', 'completed')).toBe('RESOLVED');
    expect(supportStatusFromIssue('closed', null)).toBe('RESOLVED');
  });

  it('maps a closed-not-planned issue to DECLINED', () => {
    expect(supportStatusFromIssue('closed', 'not_planned')).toBe('DECLINED');
  });
});

describe('fetchGitHubIssue', () => {
  const repo = { owner: 'acme', repo: 'widgets' };

  it('reads the issue state with the GET issues API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: 'closed',
        state_reason: 'completed',
        html_url: 'https://github.com/acme/widgets/issues/7',
      }),
    } as Response);
    const result = await fetchGitHubIssue(fetchImpl, { token: 'ghp_x', repo, number: 7 });
    expect(result).toEqual({
      state: 'closed',
      stateReason: 'completed',
      url: 'https://github.com/acme/widgets/issues/7',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/acme/widgets/issues/7');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_x');
  });

  it('returns null on a 404 (deleted issue) without throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(
      fetchGitHubIssue(fetchImpl, { token: 'ghp_x', repo, number: 9 }),
    ).resolves.toBeNull();
  });

  it('returns null when fetch throws (network/rate-limit)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      fetchGitHubIssue(fetchImpl, { token: 'ghp_x', repo, number: 9 }),
    ).resolves.toBeNull();
  });
});
