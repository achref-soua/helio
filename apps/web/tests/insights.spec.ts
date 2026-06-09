import { expect, test } from '@playwright/test';

// Insights: funnels and cohort retention. The e2e stack runs without
// ClickHouse, so the reports degrade to their "connect the analytics store"
// state — which is exactly what we assert stays usable.

test('insights page runs a funnel and shows both reports', async ({ page }) => {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conversion funnel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cohort retention' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Multi-touch attribution' })).toBeVisible();

  await page.getByTestId('funnel-steps').fill('Viewed Pricing, Signed Up');
  await page.getByTestId('funnel-run').click();
  await page.getByTestId('attribution-run').click();

  // Without ClickHouse, every report renders its no-data guidance rather than
  // crashing or hanging.
  await expect(page.getByTestId('funnel-nodata')).toBeVisible();
  await expect(page.getByTestId('retention-nodata')).toBeVisible();
  await expect(page.getByTestId('attribution-nodata')).toBeVisible();
});

test('the SQL explorer validates input and runs against the workspace', async ({ page }) => {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'SQL explorer' })).toBeVisible();

  // A non-SELECT is rejected client-of-server by the guard, before any DB call.
  await page.getByTestId('sql-input').fill('DROP TABLE events');
  await page.getByTestId('sql-run').click();
  await expect(page.getByTestId('sql-error')).toContainText('SELECT');

  // A valid SELECT passes the guard; without ClickHouse it surfaces the query
  // error rather than crashing.
  await page.getByTestId('sql-input').fill('SELECT event FROM events');
  await page.getByTestId('sql-run').click();
  await expect(page.getByTestId('sql-error')).toBeVisible();
});
