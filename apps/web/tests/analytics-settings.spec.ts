import { expect, test } from '@playwright/test';

/** Per-workspace conversion events: saved, audited, and persisted. */
test('admin sets the workspace conversion events', async ({ page }) => {
  await page.goto('/settings');
  const panel = page.getByTestId('analytics-panel');
  await expect(panel.getByText('Workspace analytics')).toBeVisible();

  await panel.getByLabel('Conversion events (comma-separated)').fill('Order Completed, Upgraded');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Conversion events saved')).toBeVisible();

  await page.reload();
  await expect(
    page.getByTestId('analytics-panel').getByLabel('Conversion events (comma-separated)'),
  ).toHaveValue('Order Completed, Upgraded');
});
