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
    await client.query('TRUNCATE "email_template" CASCADE');
  } finally {
    await client.end();
  }
});

test('compose a template with live preview and save it', async ({ page }) => {
  await page.goto('/emails');
  await page.getByRole('button', { name: 'New template' }).click();

  await page.getByLabel('Name').fill('Welcome email');
  await page.getByLabel('Subject').fill('Welcome, {{firstName|friend}}!');

  const heading = page.getByTestId('block-heading');
  await heading.getByLabel('Text').fill('Hello {{firstName|there}}');
  const paragraph = page.getByTestId('block-paragraph');
  await paragraph.getByLabel('Text').fill('Thanks for joining us.');
  const button = page.getByTestId('block-button');
  await button.getByLabel('Button label').fill('Get started');
  await button.getByLabel('Link URL').fill('https://example.com/start');

  // Server-rendered preview personalizes with the sample contact (Ada).
  const preview = page.getByTestId('template-preview');
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const frame = page.frameLocator('[data-testid="template-preview"]');
  await expect(frame.getByText('Hello Ada')).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByRole('link', { name: 'Get started' })).toBeVisible();
  await expect(page.getByTestId('preview-subject')).toContainText('Welcome, Ada!');

  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  await expect(page.getByText('Template created')).toBeVisible();
  await expect(page.getByTestId('template-card')).toContainText('Welcome email');
});

test('reorder and edit blocks, then save changes', async ({ page }) => {
  await page.goto('/emails');
  await page.getByRole('button', { name: 'Welcome email', exact: true }).click();
  await expect(page.getByTestId('template-editor-card')).toBeVisible();

  // Move the button block above the paragraph.
  const button = page.getByTestId('block-button');
  await button.getByLabel('Move up').click();
  const blockTypes = await page
    .getByTestId('block-list')
    .locator('[data-testid^="block-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(blockTypes).toEqual(['block-heading', 'block-button', 'block-paragraph']);

  await page.getByLabel('Subject').fill('Updated subject');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Template updated')).toBeVisible();
  await expect(page.getByTestId('template-card')).toContainText('Updated subject');
});

test('delete the template', async ({ page }) => {
  await page.goto('/emails');
  await page.getByRole('button', { name: 'Delete Welcome email' }).click();
  await expect(page.getByText('Template deleted')).toBeVisible();
  await expect(page.getByTestId('template-card')).toHaveCount(0);
});
