import { expect, test } from '@playwright/test';

// Product tour: the auth setup dismisses it, so clear the flag, reload, and
// step through the auto-opened tour to the end — then confirm it stays gone.

test('the product tour walks its steps and does not reappear once finished', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('helio.tour.v1.done'));
  await page.reload();

  const tour = page.getByTestId('tour');
  await expect(tour).toBeVisible();
  await expect(tour.getByText('Welcome to Helio')).toBeVisible();

  // Six steps → five Next clicks, then finish.
  for (let i = 0; i < 5; i += 1) {
    await page.getByTestId('tour-next').click();
  }
  await page.getByTestId('tour-done').click();
  await expect(page.getByTestId('tour')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('tour')).toHaveCount(0);
});
