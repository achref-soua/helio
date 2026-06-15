import { expect, test } from '@playwright/test';

// On-site widgets: create a banner, toggle it live, then delete it. The embed
// itself is a static script served at /widget.js.

test('create an on-site widget, toggle it live, then delete it', async ({ page }) => {
  await page.goto('/widgets');
  await expect(page.getByRole('heading', { name: 'On-site widgets' })).toBeVisible();

  await page.getByTestId('widget-new').click();
  await page.getByTestId('widget-name').fill('Spring sale');
  await page.getByTestId('widget-title').fill('20% off everything');
  await page.getByLabel('Message').fill('This week only.');
  // Theme the widget's button color via the palette editor.
  await page
    .getByTestId('widget-palette-editor')
    .getByRole('textbox', { name: 'Button' })
    .fill('#0066ff');
  await page.getByTestId('widget-submit').click();
  await expect(page.getByText('Widget saved')).toBeVisible();

  const row = page.getByTestId('widget-row').filter({ hasText: 'Spring sale' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Off');
  // The chosen palette is applied to the row preview as a CSS variable.
  const primary = await row
    .getByTestId('widget-preview-surface')
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--primary').trim());
  expect(primary).toBe('#0066ff');

  await row.getByTestId('widget-toggle').click();
  await expect(page.getByTestId('widget-row').filter({ hasText: 'Spring sale' })).toContainText(
    'Live',
  );

  await page
    .getByTestId('widget-row')
    .filter({ hasText: 'Spring sale' })
    .getByRole('button', { name: /Delete Spring sale/ })
    .click();
  await expect(page.getByTestId('widget-row').filter({ hasText: 'Spring sale' })).toHaveCount(0);
});
