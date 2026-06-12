import { expect, test } from '@playwright/test';

/**
 * BYO churn model panel, exercised with the intelligence service OFF —
 * the canonical e2e profile. Everything still works: rows are created
 * with a FAILED status and a plain-words reason instead of errors, the
 * page stays usable, and Activate never appears for an unvalidated model.
 */

test('register, inspect, and delete a churn model with the AI plane down', async ({ page }) => {
  const name = `e2e endpoint ${Date.now()}`;
  await page.goto('/settings');
  const panel = page.getByTestId('churn-model-panel');
  await expect(panel.getByText('Churn prediction model')).toBeVisible();

  // Register an HTTPS model server; the probe cannot run, so the row
  // lands FAILED with the unreachable-service explanation.
  const form = panel.getByTestId('churn-register-form');
  await form.getByLabel('Model name').fill(name);
  await form.getByLabel('Endpoint URL').fill('https://models.example.com/churn');
  await form.getByRole('button', { name: 'Connect & validate' }).click();

  const row = panel.getByTestId('churn-model-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('Failed')).toBeVisible();
  await expect(row.getByTestId('churn-model-error')).toContainText('AI service is unreachable');
  // No Activate for a model that never validated.
  await expect(row.getByRole('button', { name: 'Activate' })).toHaveCount(0);

  // Re-validate degrades the same way — the row stays FAILED, no crash.
  await row.getByRole('button', { name: 'Re-validate' }).click();
  await expect(row.getByText('Failed')).toBeVisible();

  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByTestId('churn-model-row').filter({ hasText: name })).toHaveCount(0);
});

test('upload a model file with the AI plane down lands a FAILED row, not an error page', async ({
  page,
}) => {
  const name = `e2e upload ${Date.now()}`;
  await page.goto('/settings');
  const panel = page.getByTestId('churn-model-panel');
  const form = panel.getByTestId('churn-upload-form');
  await form.getByLabel('Model name').fill(name);
  await form.getByLabel('Model file').setInputFiles({
    name: 'churn.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"learner": {}}'),
  });
  await form.getByRole('button', { name: 'Upload & validate' }).click();

  const row = panel.getByTestId('churn-model-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('Failed')).toBeVisible();
  await expect(row.getByTestId('churn-model-error')).toContainText('intelligence service');

  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByTestId('churn-model-row').filter({ hasText: name })).toHaveCount(0);
});

test('training-data export fails with a toast, never a broken page', async ({ page }) => {
  await page.goto('/settings');
  const panel = page.getByTestId('churn-model-panel');
  await panel.getByRole('button', { name: 'Training CSV' }).click();
  await expect(page.locator('[data-sonner-toast]')).toBeVisible();
  // The settings page is still alive and interactive.
  await expect(panel.getByText('Churn prediction model')).toBeVisible();
});
