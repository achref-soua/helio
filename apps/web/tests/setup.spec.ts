import { expect, test } from '@playwright/test';

/**
 * First-run setup (K1) on a USED instance: the wizard route is sealed
 * the moment a user exists. The actual fresh-install flow is exercised
 * against a clean database in the release self-test — it cannot run
 * inside this suite, whose database always has the setup user.
 */

test.describe('used instance', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the setup wizard is sealed once a user exists', async ({ page }) => {
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('setup-wizard')).toHaveCount(0);
  });

  test('signup stays reachable under the dev default', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
