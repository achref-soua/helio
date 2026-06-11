import { execSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

/**
 * The backups panel (ADR-0020). The sidecar isn't part of the e2e
 * profile, so its metadata rows are seeded straight into the instance
 * tables (the same admin-role write path the sidecar uses) and the
 * run-now queue is asserted at the database.
 */
const psql = (sql: string): string =>
  execSync(`docker exec helio-postgres-1 psql -U helio -d helio -tAc "${sql}"`).toString().trim();

test.beforeAll(() => {
  psql(
    'INSERT INTO backup_run (id, filename, label, status, size_bytes, encrypted, app_version, started_at, finished_at) ' +
      "VALUES ('bk_e2e_1', 'helio-e2e-test.dump', 'scheduled', 'OK', 204800, false, 'dev', now(), now()) " +
      'ON CONFLICT (id) DO NOTHING',
  );
});

test.afterAll(() => {
  psql("DELETE FROM backup_run WHERE id = 'bk_e2e_1'");
  psql("DELETE FROM backup_request WHERE label = 'dashboard'");
});

test('owner sees backups and can queue a run-now', async ({ page }) => {
  await page.goto('/settings');
  const panel = page.getByTestId('backups-panel');
  await expect(panel.getByText('Backups', { exact: true })).toBeVisible();

  const row = panel.getByRole('row', { name: /scheduled/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('200 KB')).toBeVisible();
  await expect(row.getByRole('link', { name: /Download/ })).toHaveAttribute(
    'href',
    '/api/admin/backups/bk_e2e_1',
  );

  await panel.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backup queued/)).toBeVisible();
  await expect
    .poll(() => Number(psql("SELECT count(*) FROM backup_request WHERE label = 'dashboard'")))
    .toBeGreaterThan(0);
});
