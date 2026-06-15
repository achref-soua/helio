import { expect, test } from '@playwright/test';

test.describe('anonymous access', () => {
  // No stored session for this group.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('protected routes redirect to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('login rejects bad credentials with feedback', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('wrong-password-123');
    await page.getByRole('button', { name: 'Log in' }).click();
    // Sonner toast surfaces the auth error; we stay on the login page.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('[data-sonner-toast]')).toBeVisible();
  });

  test('the password field can be revealed and hidden', async ({ page }) => {
    await page.goto('/login');
    const password = page.getByLabel('Password');
    await password.fill('hunter2');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });
});

test('authenticated session reaches the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});
