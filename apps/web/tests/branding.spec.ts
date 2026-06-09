import { expect, test } from '@playwright/test';

// White-labeling: an admin sets a brand name, sees the dashboard wordmark
// update, then resets it — leaving the shared org as it was found.

test('set a brand name, see the wordmark update, then reset', async ({ page }) => {
  const brand = `Acme Cloud ${Date.now()}`;

  await page.goto('/settings');
  const panel = page.getByTestId('branding-panel');
  await expect(panel).toBeVisible();

  await panel.getByTestId('brand-name').fill(brand);
  await panel.getByTestId('brand-save').click();
  await expect(page.getByText('Branding updated')).toBeVisible();

  // The sidebar wordmark (the link to /) now shows the brand name.
  await expect(page.locator('aside').getByRole('link', { name: brand })).toBeVisible();

  // Reset so the org is left as found (the wordmark falls back to the product).
  await panel.getByTestId('brand-name').fill('');
  await panel.getByTestId('brand-save').click();
  await expect(page.getByText('Branding updated')).toBeVisible();
  await expect(page.locator('aside').getByRole('link', { name: 'Helio' })).toBeVisible();
});
