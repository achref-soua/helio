import { expect, test } from '@playwright/test';

// The sidebar can be tucked away for a full-width canvas; the choice
// sticks per browser and the toggle brings it straight back.

test('the sidebar hides, persists across reloads, and comes back', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside');
  await expect(aside).toBeVisible();

  await page.getByTestId('sidebar-toggle').click();
  await expect(aside).toBeHidden();

  await page.reload();
  await expect(page.locator('aside')).toBeHidden();

  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('aside')).toBeVisible();
});

// The tour spotlights real targets: step two rings the contacts entry in
// the sidebar instead of floating unanchored in the middle of the screen.

test('the tour anchors its spotlight to the section it describes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('helio.tour.v1.done'));
  await page.reload();

  const tour = page.getByTestId('tour');
  await expect(tour).toBeVisible();

  // Step 2 (contacts): the card sits beside the spotlighted nav link.
  await page.getByTestId('tour-next').click();
  await expect(tour.getByText('Contacts', { exact: false })).toBeVisible();
  const target = page.locator('[data-tour="contacts"]');
  const targetBox = await target.boundingBox();
  const cardBox = await tour.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  // The card opens to the right of the sidebar target, near its row.
  expect(cardBox!.x).toBeGreaterThan(targetBox!.x + targetBox!.width);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toHaveCount(0);

  // Escape counts as dismissal — it must not reappear.
  await page.reload();
  await expect(page.getByTestId('tour')).toHaveCount(0);
});
