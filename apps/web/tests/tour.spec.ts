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

test('the help menu restarts the tour on demand', async ({ page }) => {
  await page.goto('/');
  // Even a returning operator (flag set) can replay it from Help.
  await page.evaluate(() => localStorage.setItem('helio.tour.v1.done', '1'));
  await page.reload();
  await expect(page.getByTestId('tour')).toHaveCount(0);

  await page.getByTestId('help-open').click();
  await page.getByTestId('help-tour').click();
  await expect(page.getByTestId('tour')).toBeVisible();
  await expect(page.getByText('Welcome to Helio')).toBeVisible();
  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tour')).toHaveCount(0);
});

test('the usage guide page maps every feature and links into the product', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Usage guide' })).toBeVisible();
  await expect(page.getByTestId('usage-guide')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Automate journeys' })).toBeVisible();

  // The guide's tour button replays onboarding too.
  await page.getByTestId('guide-tour').click();
  await expect(page.getByTestId('tour')).toBeVisible();
  await page.getByTestId('tour-skip').click();

  // A section CTA deep-links into the feature it explains.
  await page.getByRole('link', { name: 'Build a segment' }).click();
  await expect(page.getByRole('heading', { name: 'Segments' })).toBeVisible();
});
