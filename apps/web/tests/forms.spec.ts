import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) loadEnvFile(rootEnv);
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    await client.query('TRUNCATE "form", "contact", "contact_list", "contact_list_member" CASCADE');
  } finally {
    await client.end();
  }
});

let publicPath: string;

test('create a hosted form and copy its link', async ({ page }) => {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).click();
  await page.getByLabel('Name').fill('Newsletter signup');
  await page.getByLabel('Page heading').fill('Join the Helio newsletter');
  await page.getByRole('button', { name: 'Create form', exact: true }).click();
  await expect(page.getByText('Form created')).toBeVisible();

  const card = page.getByTestId('form-card');
  await expect(card).toContainText('Newsletter signup');
  publicPath = (await card.locator('code').textContent())!.trim();
  expect(publicPath).toMatch(/^\/f\/form_/);
});

test('a visitor signs up through the public page', async ({ browser }) => {
  // Fresh anonymous context: the hosted form needs no session.
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  await page.goto(publicPath);
  await expect(page.getByRole('heading', { name: 'Join the Helio newsletter' })).toBeVisible();
  await page.getByLabel('Email').fill('subscriber@example.com');
  await page.getByLabel('First name (optional)').fill('Subby');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText("You're in!")).toBeVisible();

  // Submitting the same email again stays idempotent.
  await page.goto(publicPath);
  await page.getByLabel('Email').fill('subscriber@example.com');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText("You're in!")).toBeVisible();
  await anonymous.close();
});

test('the submission landed exactly once in contacts', async ({ page }) => {
  await page.goto('/contacts');
  await expect(page.getByRole('cell', { name: 'subscriber@example.com' })).toHaveCount(1);
  await expect(page.getByRole('cell', { name: 'Subby' })).toBeVisible();
});

test('unknown forms return a real 404', async ({ page }) => {
  const response = await page.goto('/f/frm_does_not_exist');
  expect(response?.status()).toBe(404);
});

test('delete the form', async ({ page }) => {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'Delete Newsletter signup' }).click();
  await expect(page.getByText('Form deleted')).toBeVisible();
  await expect(page.getByTestId('form-card')).toHaveCount(0);
});
