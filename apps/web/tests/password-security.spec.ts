import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { mailpitUrl } from './mailpit';

function psql(query: string): string {
  return execFileSync('docker', [
    'exec',
    'helio-postgres-1',
    'psql',
    '-U',
    'helio',
    '-d',
    'helio',
    '-t',
    '-A',
    '-c',
    query,
  ])
    .toString()
    .trim();
}

/**
 * M1: the password lifecycle end to end — forgot → emailed link → reset
 * with the strength meter, the sessions list, and the org's forced
 * rotation policy.
 */

test.describe('forgot & reset', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the reset loop works with a real emailed link', async ({ page, request }) => {
    // A throwaway account (public signup is on in dev).
    const email = `reset-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Reset Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('first-password-was-fine-1');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();

    // Request the reset and pull the link from Mailpit.
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByTestId('forgot-sent')).toBeVisible();

    let link: string | undefined;
    await expect
      .poll(
        async () => {
          const list = await request.get(`${mailpitUrl()}/api/v1/search?query=to:${email}`);
          const { messages } = (await list.json()) as { messages: Array<{ ID: string }> };
          for (const message of messages ?? []) {
            const full = await request.get(`${mailpitUrl()}/api/v1/message/${message.ID}`);
            const { Text } = (await full.json()) as { Text: string };
            link = Text.match(/https?:\/\/\S*reset-password\S*/)?.[0];
            if (link) return true;
          }
          return false;
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    await page.goto(link!);
    const weak = 'password';
    await page.getByLabel('New password').fill(weak);
    // The meter blocks weak choices client-side.
    await expect(page.getByTestId('password-strength')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set new password' })).toBeDisabled();
    await page.getByLabel('New password').fill('much-stronger-passphrase-42');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await page.waitForURL('**/login', { timeout: 15_000 });
  });
});

test('the sessions list shows this device', async ({ page }) => {
  await page.goto('/settings');
  const sessions = page.getByTestId('sessions-list');
  await expect(sessions).toBeVisible();
  await expect(sessions.getByTestId('session-row').first()).toContainText('this device');
});

test('org-required 2FA steers unenrolled members to Security', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('require-2fa-toggle').check();
  await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();

  // Any navigation lands back on settings, with the banner explaining why.
  await page.goto('/contacts');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('require-2fa-banner')).toBeVisible();
  await expect(page.getByTestId('require-2fa-banner')).toContainText('authenticator app');

  // The banner's CTA must open the enrollment dialog even though it is a
  // same-route navigation (the panel is already mounted on /settings) —
  // and again after the dialog is dismissed, repeatedly.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByTestId('require-2fa-cta').click();
    await expect(page.getByTestId('twofa-password')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('twofa-password')).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);
  }

  // Leave the suite tidy.
  await page.getByTestId('require-2fa-toggle').uncheck();
  await page.goto('/contacts');
  await expect(page).toHaveURL(/\/contacts$/);
});

test.describe('forced rotation', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an expired password forces a change at sign-in', async ({ page, request }) => {
    // A self-contained operator: changing a password rotates the session,
    // so this flow must never run as the suite's shared user.
    const email = `rotate-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Rotate Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();
    let link: string | undefined;
    await expect
      .poll(
        async () => {
          const list = await request.get(`${mailpitUrl()}/api/v1/search?query=to:${email}`);
          const { messages } = (await list.json()) as { messages: Array<{ ID: string }> };
          if (!messages?.length) return false;
          const full = await request.get(`${mailpitUrl()}/api/v1/message/${messages[0]!.ID}`);
          const { Text } = (await full.json()) as { Text: string };
          link = Text.match(/https?:\/\/\S+verify-email\S+/)?.[0];
          return Boolean(link);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.goto(link!);
    await expect(page.getByText('Create your organization')).toBeVisible();
    // Unique per attempt — a retry must not collide with a half-finished
    // first attempt's org slug.
    await page.getByLabel('Organization name').fill(`Rotate Org ${Date.now()}`);
    await page.evaluate(() => localStorage.setItem('helio.tour.v1.done', '1'));
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({
      timeout: 15_000,
    });

    // Owner of a fresh org: turn the policy on (7 days)…
    await page.goto('/settings');
    const panel = page.getByTestId('password-policy-panel');
    await panel.getByLabel('Days').fill('7');
    await panel.getByRole('checkbox', { name: /Require a password change/ }).check();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();

    // …and make this user's password a month old.
    psql(
      `UPDATE "user" SET password_changed_at = now() - interval '30 days' ` +
        `WHERE email = '${email}'`,
    );

    await page.goto('/');
    await expect(page).toHaveURL(/\/change-password$/);
    await page.getByLabel('Current password').fill('correct-horse-battery');
    await page.getByLabel('New password').fill('rotated-passphrase-of-substance-7');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });
});
