import { expect, test } from '@playwright/test';

// Landing pages: build a page from blocks, publish it, then capture a signup
// on the public page.

test('build a landing page, publish it, and capture a signup', async ({ page }) => {
  await page.goto('/landing');
  await expect(page.getByRole('heading', { name: 'Landing pages' })).toBeVisible();

  await page.getByTestId('landing-new').click();
  await page.getByTestId('landing-title').fill('Launch page');

  // Add a heading and a form block, then fill the heading text.
  await page.getByTestId('landing-add-heading').click();
  await page.getByTestId('landing-add-form').click();
  await page.getByTestId('landing-blocks').getByRole('textbox').first().fill('Join the beta');

  // Theme the page's button color via the palette editor.
  const paletteEditor = page.getByTestId('landing-palette-editor');
  await expect(paletteEditor).toBeVisible();
  await paletteEditor.getByRole('textbox', { name: 'Button' }).fill('#00aa55');

  await page.getByTestId('landing-save').click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByTestId('landing-publish').click();
  await expect(page.getByText('Page published')).toBeVisible();

  // Follow the public link.
  const link = page.getByTestId('landing-copy-link');
  await expect(link).toBeVisible();
  const path = (await link.textContent())?.match(/\/p\/\S+/)?.[0];
  expect(path).toBeTruthy();

  await page.goto(path!);
  await expect(page.getByRole('heading', { name: 'Join the beta' })).toBeVisible();
  // The chosen palette is applied as a re-validated CSS variable.
  const primary = await page
    .locator('main')
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--primary').trim());
  expect(primary).toBe('#00aa55');
  const form = page.getByTestId('landing-form');
  await form.getByPlaceholder('you@example.com').fill('lead@example.com');
  await form.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByTestId('landing-thanks')).toBeVisible();
});
