import { expect, test } from '@playwright/test';

/**
 * Board polish (H6): real drag-and-drop, checkbox bulk move, and task
 * editing (notes included). The per-card stage select stays as the
 * keyboard/AT path and is covered by deals.spec.
 */

test('drag a deal, bulk-move two, and edit a task note', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/deals');
  await expect(page.getByTestId('deals-empty').or(page.getByTestId('deal-board'))).toBeVisible();
  if (await page.getByTestId('deals-empty').isVisible()) {
    await page.getByRole('button', { name: 'Create pipeline' }).click();
  }
  await expect(page.getByTestId('deal-board')).toBeVisible();

  for (const name of [`Drag ${stamp}`, `Bulk A ${stamp}`, `Bulk B ${stamp}`]) {
    await page.getByTestId('new-deal').click();
    await page.getByLabel('Title').fill(name);
    await page.getByRole('button', { name: 'Create deal' }).click();
    await expect(page.getByTestId('deal-card').filter({ hasText: name })).toBeVisible();
  }

  // Pointer drag: grip handle → the Qualified column.
  const dragCard = page.getByTestId('deal-card').filter({ hasText: `Drag ${stamp}` });
  const handle = dragCard.getByRole('button', { name: `Drag Drag ${stamp}` });
  const target = page.getByTestId('stage-open').nth(1); // Qualified column
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('boxes missing');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect(target.getByTestId('deal-card').filter({ hasText: `Drag ${stamp}` })).toBeVisible();

  // Bulk move the other two via checkboxes.
  await page.getByLabel(`Select Bulk A ${stamp}`).check();
  await page.getByLabel(`Select Bulk B ${stamp}`).check();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
  await page.getByLabel('Move selected to stage').click();
  await page.getByRole('option', { name: 'Proposal' }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  const proposal = page.getByTestId('stage-open').nth(2);
  await expect(
    proposal.getByTestId('deal-card').filter({ hasText: `Bulk A ${stamp}` }),
  ).toBeVisible();
  await expect(
    proposal.getByTestId('deal-card').filter({ hasText: `Bulk B ${stamp}` }),
  ).toBeVisible();

  // Task editing: create, then change the note through the pencil.
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill(`Edit me ${stamp}`);
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: `Edit Edit me ${stamp}` }).click();
  await page.getByLabel('Notes').fill('Now with a note.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Now with a note.')).toBeVisible();
});
