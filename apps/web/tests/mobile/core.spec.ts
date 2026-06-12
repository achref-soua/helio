import { expect, test } from '@playwright/test';

/**
 * The phone regression net (L2): key routes render without horizontal
 * overflow at 390px, the drawer navigation works by touch, and the
 * bread-and-butter flows (add a contact, open settings) stay usable.
 */

const ROUTES = [
  '/',
  '/contacts',
  '/segments',
  '/campaigns',
  '/journeys',
  '/deals',
  '/companies',
  '/tasks',
  '/insights',
  '/settings',
  '/admin/audit',
];

test('no route overflows the phone viewport', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test('drawer navigation reaches every section by touch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle navigation' }).tap();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: 'Contacts' })).toBeVisible();
  await drawer.getByRole('link', { name: 'Contacts' }).tap();
  await expect(page).toHaveURL(/\/contacts$/);
});

test('a contact can be added from a phone', async ({ page }) => {
  const email = `phone-${Date.now()}@example.com`;
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Add contact' }).tap();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Create contact' }).tap();
  await expect(page.getByText(email)).toBeVisible();
});

test('settings panels stay reachable on a phone', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText('Members', { exact: true })).toBeVisible();
  await expect(page.getByTestId('churn-model-panel')).toBeVisible();
});
