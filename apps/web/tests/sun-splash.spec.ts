import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { mailpitUrl } from './mailpit';

/**
 * The sunrise/sunset brand moment: a fresh browser session gets one
 * sunrise on dashboard entry (sessionStorage-gated, so a reload stays
 * quiet), sign-out plays a sunset and lands on /login, and reduced-motion
 * users see neither. The sunrise overlay is pointer-events-none and
 * unmounts on its own, so other specs are never blocked by it.
 *
 * Sign-out revokes the session server-side, so the sign-out tests run as
 * their own throwaway users (auth.setup's signup flow) — never against
 * the shared storage state the rest of the suite depends on.
 */

async function signUpFreshUser(page: Page, request: APIRequestContext): Promise<void> {
  const email = `sunset-${Date.now()}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Sunset Tester');
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
        const message = await request.get(`${mailpitUrl()}/api/v1/message/${messages[0]!.ID}`);
        const { Text } = (await message.json()) as { Text: string };
        link = Text.match(/https?:\/\/\S+verify-email\S+/)?.[0];
        return Boolean(link);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await page.goto(link!);
  await expect(page.getByText('Create your organization')).toBeVisible();
  await page.getByLabel('Organization name').fill('Sunset Org');
  await page.evaluate(() => localStorage.setItem('helio.tour.v1.done', '1'));
  await page.getByRole('button', { name: 'Create organization' }).click();
  // Generous: this is the third signup in quick succession on a dev server.
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });
}

test('sunrise plays once per session, then stays out of the way', async ({ page }) => {
  await page.goto('/');
  const splash = page.getByTestId('sun-splash');
  await expect(splash).toBeVisible();
  await expect(splash).toHaveAttribute('data-mode', 'sunrise');
  // It cleans up after itself…
  await expect(splash).toHaveCount(0, { timeout: 5_000 });
  // …and a reload in the same session does not replay it.
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(splash).toHaveCount(0);
});

test.describe('sign-out sunset', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signing out plays the sunset and lands on the login page', async ({ page, request }) => {
    await signUpFreshUser(page, request);
    await expect(page.getByTestId('sun-splash')).toHaveCount(0, { timeout: 5_000 });

    await page.getByRole('button', { name: 'Open user menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    const splash = page.getByTestId('sun-splash');
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute('data-mode', 'sunset');
    await page.waitForURL('**/login', { timeout: 15_000 });
  });
});

test.describe('reduced motion', () => {
  // Shared session, fresh context: sessionStorage is empty, so a sunrise
  // WOULD play here — reduced motion is the only thing suppressing it.
  // (No sign-out in this group: a third signup flow in one run trips the
  // Better-Auth general rate budget, and sign-out would revoke the shared
  // session. The immediate-resolve path is the same guard, exercised above.)
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('reduced-motion users never see the sunrise', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByTestId('sun-splash')).toHaveCount(0);
  });
});
