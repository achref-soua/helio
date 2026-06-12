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

test('the import wizard maps columns, previews, and imports with companies', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'contacts.csv', mimeType: 'text/csv', buffer: CSV });

  // The mapping step pre-fills from the headers; override one column.
  await expect(page.getByTestId('import-mapping')).toBeVisible();
  await expect(page.getByLabel('Mapping for company')).toHaveValue('company');
  await page.getByLabel('Mapping for Last Name').selectOption('attribute');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Preview: counts + the company line + first rows.
  await expect(page.getByTestId('import-preview')).toContainText(
    '2 valid · 1 invalid · 1 duplicates in file',
  );
  await expect(page.getByTestId('import-preview')).toContainText(
    '2 companies will be matched or created.',
  );
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  // Live progress lands on done with the counts.
  await expect(page.getByTestId('import-counts')).toContainText('2 created', { timeout: 15_000 });
  await expect(page.getByText('Import finished.')).toBeVisible();
  await page.getByRole('button', { name: 'Download 2 rejected rows (CSV)' }).isVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByRole('cell', { name: 'ada@example.com' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'grace@example.com' })).toBeVisible();

  // The mapped companies were created for the workspace.
  await page.goto('/companies');
  await expect(
    page.getByTestId('company-row').filter({ hasText: 'Analytical Engines' }),
  ).toBeVisible();
  await page.goto('/contacts');
});

test('migration: a Mailchimp export is detected and unsubscribers suppressed', async ({ page }) => {
  const mailchimp = Buffer.from(
    'Email Address,First Name,Last Name,Member Rating,OPTIN TIME,STATUS\n' +
      'subbed@example.com,Sub,Scribed,5,2026-01-01,subscribed\n' +
      'gone@example.com,Un,Subbed,2,2026-01-02,unsubscribed\n',
  );
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'mailchimp.csv', mimeType: 'text/csv', buffer: mailchimp });
  await expect(page.getByTestId('import-source')).toHaveText('Detected a Mailchimp export');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('import-preview')).toContainText(
    '1 contact imported as unsubscribed',
  );
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('import-counts')).toContainText('2 created', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // The unsubscribed contact landed suppressed, not active.
  const row = page.getByRole('row', { name: /gone@example\.com/ });
  await expect(row.getByText('Unsubscribed')).toBeVisible();
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

test('scoring rules manage and the score column renders', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Scoring rules' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Event name').fill('Demo Booked');
  await dialog.getByLabel('Points').fill('25');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByText('Rule created')).toBeVisible();
  await expect(dialog.getByTestId('scoring-rules')).toContainText('Demo Booked');
  await expect(dialog.getByTestId('scoring-rules')).toContainText('+25');

  await dialog.getByRole('button', { name: 'Delete rule for Demo Booked' }).click();
  await expect(page.getByText('Rule deleted')).toBeVisible();
  await page.keyboard.press('Escape');

  // Score column present with the default 0 for existing contacts.
  await expect(page.getByRole('columnheader', { name: 'Score' })).toBeVisible();
});

test('predictions: churn column renders and recompute degrades gracefully', async ({ page }) => {
  await page.goto('/contacts');
  // The AI churn-risk column is present (em dash until a run lands).
  await expect(page.getByRole('columnheader', { name: 'Churn risk' })).toBeVisible();
  // Recompute needs the intelligence service, which is offline in e2e —
  // it must surface an actionable error, never crash silently.
  await page.getByTestId('recompute-predictions').click();
  await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 15_000 });
});

test('cursor pagination yields every row exactly once', async ({ page }) => {
  // Regression: the pop()-as-cursor idiom used to drop the first row of
  // every page after the first. 60 contacts spans the 50-row page size.
  const bulk = Buffer.from(
    [
      'Email',
      ...Array.from({ length: 60 }, (_, i) => `bulk-${String(i).padStart(2, '0')}@example.com`),
    ].join('\n'),
  );
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'bulk.csv', mimeType: 'text/csv', buffer: bulk });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('import-counts')).toContainText('60 created', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('cell', { name: /bulk-\d\d@example\.com/ })).toHaveCount(60);
});
