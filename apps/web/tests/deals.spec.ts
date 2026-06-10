import { expect, test } from '@playwright/test';

import { pickOption } from './select';

// CRM-lite deal board: create a pipeline, add a deal, move it across
// stages, and delete it — all keyboard-accessible (no drag dependency).

test('deals appears in the primary navigation', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Deals' }),
  ).toBeVisible();
});

test('create a pipeline, add a deal, move it to Won, then delete it', async ({ page }) => {
  await page.goto('/deals');

  // Empty state → seed the default pipeline.
  await expect(page.getByTestId('deals-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Create pipeline' }).click();
  await expect(page.getByText('Pipeline created')).toBeVisible();
  await expect(page.getByTestId('deal-board')).toBeVisible();

  // Add a deal to the first stage (Lead).
  await page.getByTestId('new-deal').click();
  await page.getByLabel('Title').fill('Acme renewal');
  await page.getByLabel('Value').fill('2500');
  await page.getByRole('button', { name: 'Create deal' }).click();
  await expect(page.getByText('Deal created')).toBeVisible();

  const card = page.getByTestId('deal-card').filter({ hasText: 'Acme renewal' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('$2,500.00');

  // Move it to Won via the per-card stage select; the select reflects it.
  await pickOption(card.getByLabel('Move Acme renewal to another stage'), 'Won');
  const movedSelect = page
    .getByTestId('deal-card')
    .filter({ hasText: 'Acme renewal' })
    .getByLabel('Move Acme renewal to another stage');
  await expect(movedSelect).toHaveText('Won');

  // Delete it.
  await page
    .getByTestId('deal-card')
    .filter({ hasText: 'Acme renewal' })
    .getByRole('button', { name: 'Delete Acme renewal' })
    .click();
  await expect(page.getByText('Deal deleted')).toBeVisible();
  await expect(page.getByTestId('deal-card').filter({ hasText: 'Acme renewal' })).toHaveCount(0);
});
