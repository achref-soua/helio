import { expect, test } from '@playwright/test';

// In-app support: file a bug report from the header, then find and resolve it
// in the settings support inbox.

test('report a bug, then resolve it from the support inbox', async ({ page }) => {
  const subject = `Test report ${Date.now()}`;

  await page.goto('/');
  await page.getByTestId('report-open').click();
  await page.getByTestId('report-subject').fill(subject);
  await page.getByTestId('report-body').fill('Steps to reproduce: click things.');
  await page.getByTestId('report-submit').click();
  await expect(page.getByText('your report was sent')).toBeVisible();

  await page.goto('/settings');
  const row = page.getByTestId('support-row').filter({ hasText: subject });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Open');

  await row.getByTestId('support-resolve').click();
  await expect(page.getByText('Marked resolved')).toBeVisible();
  await expect(page.getByTestId('support-row').filter({ hasText: subject })).toContainText(
    'Resolved',
  );
});
