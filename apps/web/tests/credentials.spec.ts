import { expect, test } from '@playwright/test';

/**
 * The credential vault end to end: store an SMTP credential (secrets
 * sealed server-side), see only masks come back, verify it against the
 * real local Mailpit SMTP socket, and delete it. Also guards the no-leak
 * invariant: no envelope ever reaches the page.
 */
test('admin stores, verifies, and removes an smtp credential', async ({ page }) => {
  const smtpPort = process.env.SMTP_PORT ?? '1025';
  await page.goto('/settings');
  const panel = page.getByTestId('credentials-panel');
  await expect(panel.getByText('Provider credentials')).toBeVisible();

  // Add: Email sending → SMTP.
  await panel.getByLabel('Add a Email sending credential').click();
  await page.getByRole('option', { name: 'SMTP', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Local Mailpit');
  await dialog.getByLabel('Host', { exact: true }).fill('localhost');
  await dialog.getByLabel('Port', { exact: true }).fill(smtpPort);
  await dialog.getByLabel('From email').fill('gate@helio.test');
  // A secret without a username: stored and masked, but the probe uses
  // an unauthenticated connection (Mailpit accepts any).
  await dialog.getByLabel('SMTP password').fill('not-a-real-secret');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  const row = panel.locator('li', { hasText: 'Local Mailpit' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Unverified')).toBeVisible();
  await expect(row.getByText('••••cret')).toBeVisible();

  // The no-leak invariant: sealed envelopes never reach the client.
  expect(await page.content()).not.toContain('enc:v1');

  // Verify runs a real SMTP handshake against Mailpit.
  await row.getByRole('button', { name: 'Verify' }).click();
  await expect(row.getByText('Verified', { exact: true })).toBeVisible();

  // A test send delivers a real message through the credential (to Mailpit).
  await row.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText(/Test email sent to/)).toBeVisible();

  // Editing without re-entering the secret keeps it stored.
  await row.getByRole('button', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByLabel('SMTP password')).toHaveAttribute(
    'placeholder',
    /Stored \(••••cret\)/,
  );
  await editDialog.getByLabel('Name', { exact: true }).fill('Mailpit Relay');
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  const renamed = panel.locator('li', { hasText: 'Mailpit Relay' });
  await expect(renamed).toBeVisible();
  await expect(renamed.getByText('••••cret')).toBeVisible();

  // Delete.
  page.once('dialog', (confirm) => void confirm.accept());
  await renamed.getByRole('button', { name: 'Delete Mailpit Relay' }).click();
  await expect(panel.locator('li', { hasText: 'Mailpit Relay' })).toHaveCount(0);
});
