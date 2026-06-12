import { expect, test } from '@playwright/test';

import { pickOption } from './select';

/**
 * Sales reports (H5): win a deal, then the report shows a real win rate,
 * the won value on the leaderboard, and the open pipeline table.
 */

test('winning a deal lands in the sales report', async ({ page }) => {
  const title = `Report deal ${Date.now()}`;
  await page.goto('/deals');
  await expect(page.getByTestId('deals-empty').or(page.getByTestId('deal-board'))).toBeVisible();
  if (await page.getByTestId('deals-empty').isVisible()) {
    await page.getByRole('button', { name: 'Create pipeline' }).click();
  }
  await expect(page.getByTestId('deal-board')).toBeVisible();

  await page.getByTestId('new-deal').click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Value').fill('77');
  await page.getByRole('button', { name: 'Create deal' }).click();
  const card = page.getByTestId('deal-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await pickOption(card.getByLabel(`Move ${title} to another stage`), 'Won');

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByTestId('sales-reports')).toBeVisible();
  // A real win rate (not the em-dash placeholder) and the won value.
  await expect(page.getByTestId('sales-winrate')).toContainText('%');
  await expect(page.getByTestId('sales-leaderboard')).toContainText('77');
  await expect(page.getByTestId('sales-forecast')).toBeVisible();
});
