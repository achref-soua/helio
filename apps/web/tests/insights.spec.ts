import { expect, test } from '@playwright/test';

// Insights: funnels and cohort retention. The e2e stack runs without
// ClickHouse, so the reports degrade to their "connect the analytics store"
// state — which is exactly what we assert stays usable.

test('insights page runs a funnel and shows both reports', async ({ page }) => {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conversion funnel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cohort retention' })).toBeVisible();

  await page.getByTestId('funnel-steps').fill('Viewed Pricing, Signed Up');
  await page.getByTestId('funnel-run').click();

  // Without ClickHouse, both reports render their no-data guidance rather than
  // crashing or hanging.
  await expect(page.getByTestId('funnel-nodata')).toBeVisible();
  await expect(page.getByTestId('retention-nodata')).toBeVisible();
});
