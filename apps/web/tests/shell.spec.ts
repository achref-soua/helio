import { expect, test } from '@playwright/test';

test('dashboard shell renders with primary navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const item of ['Dashboard', 'Contacts', 'Segments', 'Journeys', 'Settings']) {
    await expect(nav.getByRole('link', { name: item })).toBeVisible();
  }
});

test('navigation reaches section placeholders and 404s are handled', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Journeys' })
    .click();
  await expect(page.getByRole('heading', { name: 'Journeys' })).toBeVisible();

  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('theme toggle switches color scheme class', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.getByRole('menuitem', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('healthz reports ok', async ({ request }) => {
  const response = await request.get('/api/healthz');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

test('site icons are served without a session', async ({ browser }) => {
  // Browsers fetch favicons credential-less; the auth proxy must not
  // bounce them to /login.
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const svg = await anonymous.request.get('/icon.svg');
  expect(svg.status()).toBe(200);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  const apple = await anonymous.request.get('/apple-icon.png');
  expect(apple.status()).toBe(200);
  expect(apple.headers()['content-type']).toContain('image/png');
  await anonymous.close();
});
