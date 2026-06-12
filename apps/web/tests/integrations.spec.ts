import { expect, test } from '@playwright/test';

/**
 * The integrations panel (Shopify / Salesforce): connecting stores a
 * credential row (secrets sealed in the vault), the row can be toggled,
 * and disconnecting removes it. No external calls happen at connect
 * time, so the suite needs neither service.
 */

test('connect, toggle, and disconnect a Shopify integration', async ({ page }) => {
  const shop = `e2e-${Date.now()}.myshopify.com`;
  await page.goto('/settings');
  const panel = page.getByTestId('integrations-panel');
  await expect(panel).toBeVisible();

  await panel.getByTestId('integration-connect').click();
  await page.getByTestId('integration-shop').fill(shop);
  await page.getByTestId('integration-secret').fill('shpss_e2e_secret_0123456789');
  await page.getByTestId('integration-save').click();

  const row = panel.getByTestId('integration-row').filter({ hasText: shop });
  await expect(row).toBeVisible();

  await row.getByTestId('integration-toggle').click();
  await expect(row).toContainText('Paused');

  await row.getByTestId('integration-disconnect').click();
  await expect(panel.getByTestId('integration-row').filter({ hasText: shop })).toHaveCount(0);
});

test('connect and disconnect a Salesforce integration', async ({ page }) => {
  const instance = `https://e2e-${Date.now()}.my.salesforce.com`;
  await page.goto('/settings');
  const panel = page.getByTestId('integrations-panel');

  await panel.getByTestId('integration-connect-sf').click();
  await page.getByTestId('integration-instance').fill(instance);
  await page.getByTestId('integration-token').fill('00De2e_access_token');
  await page.getByTestId('integration-save-sf').click();

  const row = panel.getByTestId('integration-row').filter({ hasText: 'salesforce' });
  await expect(row).toBeVisible();
  await row.getByTestId('integration-disconnect').click();
  await expect(panel.getByTestId('integration-row').filter({ hasText: 'salesforce' })).toHaveCount(
    0,
  );
});
