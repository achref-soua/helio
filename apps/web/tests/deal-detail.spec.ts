import { expect, test } from '@playwright/test';

/**
 * The deal detail page (H3): opened from a board card, owner assigned,
 * a note added, closed as won with a reason — and the history records
 * every step with the reason preserved.
 */

test('deal detail: owner, notes, won-with-reason, history', async ({ page }) => {
  const title = `Detail deal ${Date.now()}`;
  await page.goto('/deals');

  // This spec runs before deals.spec (alphabetical): the org is fresh,
  // so the empty state offers pipeline creation.
  await expect(page.getByTestId('deals-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Create pipeline' }).click();
  await expect(page.getByTestId('deal-board')).toBeVisible();

  await page.getByTestId('new-deal').click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Value').fill('4200');
  await page.getByRole('button', { name: 'Create deal' }).click();

  const card = page.getByTestId('deal-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: title }).click();

  await expect(page.getByTestId('deal-detail')).toBeVisible();
  await expect(page.getByTestId('deal-status')).toHaveText('Open');

  // Assign the deal to the only member (the e2e operator).
  await page.getByLabel('Owner').selectOption({ index: 1 });
  await expect(page.getByLabel('Owner')).not.toHaveValue('');

  // A note round-trips.
  await page.getByLabel('New note').fill('Budget approved — closing this week.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByTestId('deal-note').filter({ hasText: 'Budget approved' })).toBeVisible();

  // Won, with a reason the history keeps.
  await page.getByRole('button', { name: 'Mark won' }).click();
  await page.getByLabel('Reason (optional — kept in the history)').fill('Signed the annual plan');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('deal-status')).toHaveText('Won');
  await expect(page.getByTestId('deal-history')).toContainText('deal.won');
  await expect(page.getByTestId('deal-history')).toContainText('Signed the annual plan');
  await expect(page.getByTestId('deal-history')).toContainText('deal.owner_changed');

  // Reopen still works (and is recorded).
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByTestId('deal-status')).toHaveText('Open');
});
