import { expect, test } from '@playwright/test';

/**
 * Settings is grouped into labelled bands (v2.0.5) instead of one flat wall.
 * The fresh e2e user owns the org, so every section is visible, and the
 * panels still render inside them.
 */
test('settings is organized into labelled sections', async ({ page }) => {
  await page.goto('/settings');
  for (const name of ['Team & access', 'Channels & delivery', 'Workspace', 'Maintenance']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('updates-panel')).toBeVisible();
  await expect(page.getByTestId('backups-panel')).toBeVisible();
});
