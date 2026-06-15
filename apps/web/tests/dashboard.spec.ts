import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

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

test('customize the dashboard: add, hide, reorder, and it persists', async ({ page }) => {
  await page.goto('/');
  const grid = page.getByTestId('dashboard-grid');

  // Quick links is off by default; opens is on.
  await expect(page.getByTestId('widget-quickLinks')).toHaveCount(0);
  await expect(page.getByTestId('widget-opens')).toBeVisible();

  await page.getByTestId('dashboard-customize').click();

  // Add a hidden widget and hide a visible one.
  await page.getByTestId('widget-quickLinks-add').click();
  await expect(page.getByTestId('widget-quickLinks')).toBeVisible();
  await page.getByTestId('widget-opens-hide').click();
  await expect(page.getByTestId('widget-opens')).toHaveCount(0);

  // Reorder: contacts is first; move it down so activeJourneys leads.
  await expect(grid.locator('> div').first()).toHaveAttribute('data-testid', 'widget-contacts');
  await page.getByTestId('widget-contacts-down').click();
  await expect(grid.locator('> div').first()).toHaveAttribute(
    'data-testid',
    'widget-activeJourneys',
  );

  await page.getByTestId('dashboard-save').click();
  await expect(page.getByText('Dashboard saved')).toBeVisible();

  // The customized layout survives a reload (persisted per member).
  await page.reload();
  await expect(page.getByTestId('widget-quickLinks')).toBeVisible();
  await expect(page.getByTestId('widget-opens')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-grid').locator('> div').first()).toHaveAttribute(
    'data-testid',
    'widget-activeJourneys',
  );
});
