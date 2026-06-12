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

  // Reset so the org is left as found — with no brand name the wordmark
  // falls back to the organization's own name, not the product's.
  await panel.getByTestId('brand-name').fill('');
  await panel.getByTestId('brand-save').click();
  await expect(page.getByText('Branding updated')).toBeVisible();
  await expect(page.locator('aside').getByRole('link', { name: 'E2E Org' })).toBeVisible();
});

test('upload a logo from device and see it served from /a', async ({ page }) => {
  // A 16×16 amber PNG, inline so the spec carries its own fixture.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mN4NUWfJMQwqmFUw/DVAADMj60Q5ZtGuQAAAABJRU5ErkJggg==',
    'base64',
  );

  await page.goto('/settings');
  const panel = page.getByTestId('branding-panel');
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });

  // The URL field flips to this instance's asset route once stored.
  await expect(panel.getByTestId('brand-logo')).toHaveValue(/\/a\//, { timeout: 15_000 });
  const url = await panel.getByTestId('brand-logo').inputValue();
  const served = await page.request.get(url);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');

  // Leave the org as found.
  await panel.getByTestId('brand-logo').fill('');
  await panel.getByTestId('brand-save').click();
  await expect(page.getByText('Branding updated')).toBeVisible();
});
