import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

/**
 * The /admin audit viewer (G3): list, filter, export. The spec seeds its
 * own audited action first (an invitation — lands via the auth-kernel
 * hook), because each e2e run starts with a fresh organization.
 */

test('audit viewer lists, filters, and exports the trail', async ({ page }) => {
  const email = `admin-audit-${Date.now()}@example.com`;
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent')).toBeVisible();

  // The nav entry is visible to the owner and reaches the viewer.
  await page.getByRole('navigation', { name: 'Primary' }).getByText('Admin').click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(page.getByTestId('audit-view')).toBeVisible();
  await expect(page.getByTestId('audit-row').first()).toBeVisible();

  // Filter down to the kernel-written member events.
  await page.getByLabel('Action starts with').fill('member.');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByTestId('audit-row').first()).toContainText('member.invited');
  await expect(page.getByTestId('audit-row').first()).toContainText(email);

  // The current filter exports as CSV.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('helio-audit-log.csv');
});

test('reports render Postgres numbers and degrade engagement without ClickHouse', async ({
  page,
}) => {
  await page.goto('/admin/reports');
  await expect(page.getByTestId('reports-view')).toBeVisible();
  await expect(page.getByTestId('report-sends')).toBeVisible();
  await expect(page.getByTestId('report-growth')).toBeVisible();
  await expect(page.getByTestId('report-journeys')).toBeVisible();
  await expect(page.getByTestId('report-members')).toBeVisible();
  // ClickHouse is off in the e2e profile — the campaign card says so in
  // plain words and keeps its Postgres send counts.
  await expect(page.getByTestId('report-campaigns')).toContainText('analytics store');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('report-journeys').getByRole('button', { name: 'CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('helio-journey-report.csv');
});

function psql(query: string): string {
  return execFileSync('docker', [
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
    query,
  ])
    .toString()
    .trim();
}

test('database studio browses, edits, and deletes with a typed confirm', async ({ page }) => {
  const email = `studio-${Date.now()}@example.com`;
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Add contact' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Create contact' }).click();
  await expect(page.getByText(email)).toBeVisible();

  await page.goto('/admin/database');
  await expect(page.getByTestId('database-studio')).toBeVisible();
  // The allow-list is the security boundary: no auth or secret tables.
  const tablePicker = page.getByLabel('Table', { exact: true });
  const options = await tablePicker.locator('option').allInnerTexts();
  expect(options.join(',')).not.toMatch(/user|credential|key|token|session/i);

  const row = page.getByTestId('studio-row').filter({ hasText: email });
  await expect(row).toBeVisible();

  // Edit a field; the change shows in the table.
  await row.getByRole('button', { name: /Edit row/ }).click();
  await page.getByLabel('firstName', { exact: true }).fill('Studio');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row).toContainText('Studio');

  // The category chart renders for tables with a groupable field.
  await expect(page.getByTestId('studio-chart')).toBeVisible();

  // Delete only proceeds after re-authenticating AND typing the phrase.
  await row.getByRole('button', { name: /Delete row/ }).click();
  const deleteButton = page.getByRole('button', { name: 'Delete row', exact: true });
  await expect(deleteButton).toBeDisabled();
  await page.getByPlaceholder('I understand').fill('I understand');
  await expect(deleteButton).toBeDisabled(); // phrase alone is not enough
  await page.getByTestId('studio-delete-password').fill('wrong-password');
  await deleteButton.click();
  await expect(page.getByText('Wrong password.')).toBeVisible(); // server re-auth rejects
  await page.getByTestId('studio-delete-password').fill('correct-horse-battery');
  await deleteButton.click();
  await expect(page.getByTestId('studio-row').filter({ hasText: email })).toHaveCount(0);
});

test('health shows honest service status and the alert bell round-trips', async ({ page }) => {
  // This run's organization is the newest one; seed it one unread alert
  // (the superuser connection bypasses RLS, like the backups spec).
  const orgId = psql('SELECT id FROM organization ORDER BY created_at DESC LIMIT 1');
  psql(
    `INSERT INTO system_alert (id, organization_id, kind, message, context) ` +
      `VALUES ('alrt_e2e_${Date.now()}', '${orgId}', 'e2e_probe', 'Test alert from the e2e suite', '{}')`,
  );

  await page.goto('/admin/health');
  await expect(page.getByTestId('health-view')).toBeVisible();
  // The e2e profile runs core only: postgres is up, the intelligence
  // service is down, and the optional stores read as Off — not as errors.
  const services = page.getByTestId('health-services');
  await expect(services.getByText('web', { exact: true })).toBeVisible();
  await expect(services.getByText('intelligence')).toBeVisible();
  await expect(services.getByText('Down').first()).toBeVisible();
  const stores = page.getByTestId('health-stores');
  await expect(stores.getByText('postgres')).toBeVisible();
  await expect(stores.getByText('Up').first()).toBeVisible();

  // The seeded alert is in the feed and on the bell.
  await expect(page.getByTestId('health-alerts')).toContainText('Test alert from the e2e suite');
  await expect(page.getByTestId('alert-badge')).toBeVisible();

  // Mark all read: the feed greys out and the badge goes away.
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByTestId('alert-badge')).toHaveCount(0);
});
