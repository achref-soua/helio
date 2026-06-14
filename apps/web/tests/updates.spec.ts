import { expect, test } from '@playwright/test';

/**
 * The Updates panel (Settings → Updates). The updater sidecar isn't part of
 * the e2e profile and the app runs as a "dev" build, so this is a wiring
 * smoke test: the panel renders, the `updates.check` round-trip works, and
 * the controls are present. The real recreate flow is verified against a
 * throwaway self-host install, not here.
 */
test('owner sees the Updates panel with the running build', async ({ page }) => {
  await page.goto('/settings');
  const panel = page.getByTestId('updates-panel');
  await expect(panel.getByText('Updates', { exact: true })).toBeVisible();

  // A source/e2e build reports "dev" and never offers a one-click update.
  await expect(panel.getByText('dev build')).toBeVisible();
  await expect(panel.getByText(/development build/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Update to' })).toHaveCount(0);

  // The check control is present and stays usable.
  const check = panel.getByRole('button', { name: 'Check for updates' });
  await expect(check).toBeVisible();
  await check.click();
  await expect(panel.getByText('dev build')).toBeVisible();
});
