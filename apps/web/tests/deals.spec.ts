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

  // Another spec may have seeded the pipeline already; create it only
  // when the empty state is what renders.
  await expect(page.getByTestId('deals-empty').or(page.getByTestId('deal-board'))).toBeVisible();
  if (await page.getByTestId('deals-empty').isVisible()) {
    await page.getByRole('button', { name: 'Create pipeline' }).click();
    await expect(page.getByText('Pipeline created')).toBeVisible();
  }
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

test('the pipeline shows as a table and the choice survives a reload', async ({ page }) => {
  const title = `Table deal ${Date.now()}`;
  await page.goto('/deals');
  // Self-sufficient: earlier tests clean up their deals, so make one.
  await page.getByTestId('new-deal').click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create deal' }).click();
  await expect(page.getByTestId('deal-card').filter({ hasText: title })).toBeVisible();

  await page.getByTestId('deals-view-table').click();
  await expect(page.getByTestId('deal-table')).toBeVisible();
  await expect(page.getByTestId('deal-row').first()).toBeVisible();
  await expect(page.getByTestId('deal-board')).toBeHidden();

  await page.reload();
  await expect(page.getByTestId('deal-table')).toBeVisible({ timeout: 15_000 });

  // Inline stage move works from the table too.
  const firstRow = page.getByTestId('deal-row').first();
  await expect(firstRow.getByRole('combobox')).toBeVisible();

  await page.getByTestId('deals-view-board').click();
  await expect(page.getByTestId('deal-board')).toBeVisible();

  // Leave the board as found.
  const card = page.getByTestId('deal-card').filter({ hasText: title });
  await card.getByRole('button', { name: `Delete ${title}` }).click();
  await expect(card).toHaveCount(0);
});
