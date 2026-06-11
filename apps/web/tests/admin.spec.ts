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
