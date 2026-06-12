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

test('onboarding checklist tracks real state and the manifest serves', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const checklist = page.getByTestId('onboarding-checklist');
  await expect(checklist).toBeVisible();
  // A fresh org: nothing connected yet, so items render unchecked links.
  await expect(checklist.getByTestId('checklist-email')).toBeVisible();
  await expect(checklist.getByTestId('checklist-contacts')).toBeVisible();

  // Dismiss persists across reloads.
  await checklist.getByRole('button', { name: 'Dismiss checklist' }).click();
  await expect(checklist).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByTestId('onboarding-checklist')).toHaveCount(0);

  // The PWA manifest is live and sane.
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const body = (await manifest.json()) as { name: string; icons: unknown[] };
  expect(body.name).toBe('Helio');
  expect(body.icons.length).toBeGreaterThan(0);

  // The Help menu offers the install dialog.
  await page.getByTestId('help-open').click();
  await page.getByTestId('help-install').click();
  await expect(page.getByTestId('install-dialog')).toBeVisible();
});
