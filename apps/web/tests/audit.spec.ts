import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

/**
 * G2 audit expansion: auth-kernel events (here: an invitation, sent
 * through Better-Auth's /organization/invite-member) land in the
 * organization audit log via the after-hook. Asserted straight in
 * Postgres — the viewer UI arrives with G3.
 */

function countAudit(action: string, targetId: string): number {
  const out = execFileSync('docker', [
    'exec',
    'helio-postgres-1',
    'psql',
    '-U',
    'helio',
    '-d',
    'helio',
    '-t',
    '-A',
    '-c',
    `SELECT count(*) FROM audit_log WHERE action = '${action}' AND target_id = '${targetId}'`,
  ]);
  return Number(out.toString().trim());
}

test('inviting a member writes an auth-kernel audit row', async ({ page }) => {
  const email = `audit-invite-${Date.now()}@example.com`;
  await page.goto('/settings');
  await expect(page.getByText('Members', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent')).toBeVisible();

  await expect.poll(() => countAudit('member.invited', email), { timeout: 10_000 }).toBe(1);
});

test('running analytics SQL is audited even when the store is down', async ({ page }) => {
  await page.goto('/insights');
  await page.getByLabel('SQL query').fill('SELECT count() AS events FROM events');
  await page.getByRole('button', { name: 'Run query' }).click();
  // ClickHouse is off in the e2e profile — the page degrades gracefully,
  // but the execution attempt itself must still be on the record.
  await expect
    .poll(() => {
      const out = execFileSync('docker', [
        'exec',
        'helio-postgres-1',
        'psql',
        '-U',
        'helio',
        '-d',
        'helio',
        '-t',
        '-A',
        '-c',
        `SELECT count(*) FROM audit_log WHERE action = 'analytics.sql_executed'`,
      ]);
      return Number(out.toString().trim());
    })
    .toBeGreaterThan(0);
});
