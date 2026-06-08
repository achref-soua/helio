import { expect, test } from '@playwright/test';

test('overview shows live KPIs and degrades analytics gracefully', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // Postgres-backed KPIs render numbers regardless of ClickHouse.
  for (const kpi of ['contacts', 'activeJourneys', 'emailsSent', 'opens']) {
    await expect(page.getByTestId(`kpi-${kpi}`)).toBeVisible();
  }

  // Either real chart data (full stack) or an honest empty/degraded state.
  const chart = page.getByTestId('events-chart');
  const empty = page.getByTestId('chart-empty');
  await expect(chart.or(empty).first()).toBeVisible({ timeout: 15_000 });
});
