import { expect, test } from '@playwright/test';

// A fresh org has no subscription row, so it's UNLIMITED (self-hosted):
// the billing panel shows the plan and the contact usage, with no cap.
test('billing panel shows the self-hosted unlimited plan and usage', async ({ page }) => {
  await page.goto('/settings');
  const panel = page.getByTestId('billing-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('billing-plan')).toHaveText('Unlimited');
  // Usage renders a count (no "/ limit" when unlimited).
  await expect(page.getByTestId('billing-usage')).toBeVisible();
  await expect(page.getByTestId('billing-usage')).not.toContainText('/');
});
