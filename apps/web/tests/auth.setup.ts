import { expect, test as setup } from '@playwright/test';

const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;
export const STORAGE_STATE = 'test-results/.auth/user.json';

/**
 * Signs up a fresh user, completes email verification via the Mailpit API,
 * and persists the authenticated storage state for the main test project.
 * This IS the core signup→verify→session flow under test.
 */
setup('sign up and verify via Mailpit', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E Operator');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  // Fetch the verification link from Mailpit.
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = await request.get(`${MAILPIT}/api/v1/search?query=to:${email}`);
        const { messages } = (await list.json()) as { messages: Array<{ ID: string }> };
        if (!messages?.length) return false;
        const message = await request.get(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
        const { Text } = (await message.json()) as { Text: string };
        link = Text.match(/https?:\/\/\S+verify-email\S+/)?.[0];
        return Boolean(link);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Visiting the link verifies the address and signs the user in; with no
  // organization yet, the dashboard redirects to onboarding.
  await page.goto(link!);
  await expect(page.getByText('Create your organization')).toBeVisible();
  await page.getByLabel('Organization name').fill('E2E Org');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
