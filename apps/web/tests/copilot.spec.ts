import { expect, test } from '@playwright/test';

// The e2e stack runs without the intelligence service or an LLM key, so
// the copilot must render fully and fail *actionably* — never silently or
// with a crash. That graceful degradation is exactly what this asserts.
test('the copilot page renders its panels', async ({ page }) => {
  await page.goto('/copilot');
  await expect(page.getByRole('heading', { name: 'AI Copilot' })).toBeVisible();
  await expect(page.getByTestId('copilot-chat')).toBeVisible();
  await expect(page.getByTestId('copilot-segment')).toBeVisible();
  await expect(page.getByTestId('copilot-journey')).toBeVisible();
});

test('a chat attempt without the AI service surfaces an actionable error', async ({ page }) => {
  await page.goto('/copilot');
  await page.getByLabel('Ask the copilot…').fill('How many contacts do I have?');
  await page.getByRole('button', { name: 'Send' }).click();
  // The user's message stays; an unreachable/unconfigured service toasts.
  await expect(page.getByTestId('turn-user')).toContainText('How many contacts');
  await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 15_000 });
});

test('drafting a segment without the AI service degrades gracefully', async ({ page }) => {
  await page.goto('/copilot');
  await page
    .getByLabel('e.g. pro customers who opened an email in the last week')
    .fill('pro customers');
  await page.getByTestId('copilot-segment').getByRole('button', { name: 'Draft' }).click();
  await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 15_000 });
  // No draft card appears when generation fails.
  await expect(page.getByTestId('segment-draft')).toHaveCount(0);
});

test('copilot appears in the primary navigation', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Copilot' }),
  ).toBeVisible();
});
