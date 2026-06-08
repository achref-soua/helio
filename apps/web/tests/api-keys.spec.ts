import { expect, test } from '@playwright/test';

// Public REST API keys: an admin creates a key (revealed once), sees it
// listed by its prefix, and revokes it. The gateway-side verification of
// these keys is covered by the @helio/api contract test.

test('create an API key, see it listed, then revoke it', async ({ page }) => {
  const name = `e2e-key-${Date.now()}`;

  await page.goto('/settings');
  const panel = page.getByTestId('api-keys-panel');
  await expect(panel).toBeVisible();

  await panel.getByTestId('api-key-create').click();
  await page.getByTestId('api-key-name').fill(name);
  await page.getByTestId('api-key-submit').click();

  // The secret is revealed exactly once and is a gateway key (hk_…).
  await expect(page.getByTestId('api-key-secret')).toBeVisible();
  const secret = (await page.getByTestId('api-key-secret').textContent())?.trim();
  expect(secret).toMatch(/^hk_/);
  await page.getByRole('button', { name: 'Done' }).click();

  // It appears in the list by name; the full secret is never shown again.
  const row = page.getByTestId('api-key-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(secret!);

  await row.getByTestId('api-key-revoke').click();
  await expect(page.getByTestId('api-key-row').filter({ hasText: name })).toHaveCount(0);
});
