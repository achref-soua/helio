import { expect, test } from '@playwright/test';

// Outbound webhooks: an admin registers an endpoint (signing secret revealed
// once), subscribes it to an event, disables and re-enables it, then deletes
// it. Signing and durable delivery are covered by @helio/core and the worker
// time-skipping tests.

test('register a webhook endpoint, toggle it, then delete it', async ({ page }) => {
  const url = `https://example.test/hooks/${Date.now()}`;

  await page.goto('/settings');
  const panel = page.getByTestId('webhooks-panel');
  await expect(panel).toBeVisible();

  await panel.getByTestId('webhook-create').click();
  await page.getByTestId('webhook-url').fill(url);
  await page.getByTestId('webhook-event-deal.won').check();
  await page.getByTestId('webhook-submit').click();

  // The signing secret is revealed exactly once (whsec_…).
  await expect(page.getByTestId('webhook-secret')).toBeVisible();
  const secret = (await page.getByTestId('webhook-secret').textContent())?.trim();
  expect(secret).toMatch(/^whsec_/);
  await page.getByRole('button', { name: 'Done' }).click();

  const row = page.getByTestId('webhook-row').filter({ hasText: url });
  await expect(row).toBeVisible();
  await expect(row).toContainText('deal.won');
  await expect(row).toContainText('Enabled');

  // Disable, then re-enable.
  await row.getByTestId('webhook-toggle').click();
  await expect(page.getByTestId('webhook-row').filter({ hasText: url })).toContainText('Disabled');
  await page
    .getByTestId('webhook-row')
    .filter({ hasText: url })
    .getByTestId('webhook-toggle')
    .click();
  await expect(page.getByTestId('webhook-row').filter({ hasText: url })).toContainText('Enabled');

  await page
    .getByTestId('webhook-row')
    .filter({ hasText: url })
    .getByTestId('webhook-remove')
    .click();
  await expect(page.getByTestId('webhook-row').filter({ hasText: url })).toHaveCount(0);
});
