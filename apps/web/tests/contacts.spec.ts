import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

const CSV = Buffer.from(
  [
    'Email,First Name,Last Name,company',
    'ada@example.com,Ada,Lovelace,Analytical Engines',
    'grace@example.com,Grace,Hopper,US Navy',
    'broken-row,,,Nowhere',
    'ada@example.com,Dupe,Row,Twice',
  ].join('\n'),
);

test.describe.configure({ mode: 'serial' });

// Serial groups retry as a unit, so every attempt must start from clean
// contact data — the run-level wipe in global-setup only happens once.
test.beforeAll(async () => {
  const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) loadEnvFile(rootEnv);
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    await client.query('TRUNCATE "contact", "contact_list", "contact_list_member" CASCADE');
  } finally {
    await client.end();
  }
});

test('create a contact manually', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Add contact' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill('manual@example.com');
  await dialog.getByLabel('First name').fill('Manny');
  await page.getByRole('button', { name: 'Create contact' }).click();
  // Generous timeout: the first mutation can be slow while parallel
  // workers warm the server, and the toast auto-dismisses.
  await expect(page.getByText('Contact created')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('cell', { name: 'manual@example.com' })).toBeVisible();
});

test('import a CSV with validation summary', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'contacts.csv', mimeType: 'text/csv', buffer: CSV });
  await expect(page.getByTestId('import-summary')).toHaveText(
    '2 valid · 1 invalid · 1 duplicates in file',
  );
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported 2 contacts/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ada@example.com' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'grace@example.com' })).toBeVisible();
});

test('lists: create, bulk add, filter, remove', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByLabel('List name').fill('Pioneers');
  await page.getByRole('button', { name: 'Create list' }).click();

  // Select the two imported contacts and add them to the list.
  for (const email of ['ada@example.com', 'grace@example.com']) {
    await page
      .getByRole('row', { name: new RegExp(email) })
      .getByRole('checkbox', { name: 'Select row' })
      .check();
  }
  await page.getByRole('button', { name: /Add 2 to list/ }).click();
  await page.getByRole('menuitem', { name: 'Pioneers' }).click();
  await expect(page.getByText('Added 2 contacts to the list')).toBeVisible();

  // Filter chip shows the membership count and narrows the table.
  await page.getByRole('button', { name: 'Pioneers · 2' }).click();
  await expect(page.getByRole('cell', { name: 'manual@example.com' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'ada@example.com' })).toBeVisible();
});

test('delete a contact', async ({ page }) => {
  await page.goto('/contacts');
  const row = page.getByRole('row', { name: /manual@example.com/ });
  await row.getByRole('button', { name: 'Contact actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('Contact deleted')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'manual@example.com' })).toHaveCount(0);
});
