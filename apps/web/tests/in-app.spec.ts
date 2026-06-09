import { expect, test } from '@playwright/test';

// In-app messages: compose a message (live by default), pause it, then delete
// it. Delivery happens through a journey's "Send in-app" step + the SDK.

test('compose an in-app message, pause it, then delete it', async ({ page }) => {
  await page.goto('/in-app');
  await expect(page.getByRole('heading', { name: 'In-app messages' })).toBeVisible();

  await page.getByTestId('in-app-new').click();
  await page.getByTestId('in-app-name').fill('Trial nudge');
  await page.getByTestId('in-app-title').fill('Your trial ends soon');
  await page.getByLabel('Body').fill('Upgrade to keep your data.');
  await page.getByTestId('in-app-submit').click();
  await expect(page.getByText('Message saved')).toBeVisible();

  const row = page.getByTestId('in-app-row').filter({ hasText: 'Trial nudge' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Live');

  await row.getByTestId('in-app-toggle').click();
  await expect(page.getByTestId('in-app-row').filter({ hasText: 'Trial nudge' })).toContainText(
    'Paused',
  );

  await page
    .getByTestId('in-app-row')
    .filter({ hasText: 'Trial nudge' })
    .getByRole('button', { name: /Delete Trial nudge/ })
    .click();
  await expect(page.getByTestId('in-app-row').filter({ hasText: 'Trial nudge' })).toHaveCount(0);
});
