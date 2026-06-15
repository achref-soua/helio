import { describe, expect, it, vi } from 'vitest';

import {
  buildSupportIssue,
  createGitHubIssue,
  githubNewIssueUrl,
  parseGithubRepo,
  supportIssueLabels,
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
