import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

const CSV = Buffer.from(
  [
    'Email,First Name,plan',
    'ada@example.com,Ada,pro',
    'grace@example.com,Grace,trial',
    'alan@example.com,Alan,',
  ].join('\n'),
);

test.describe.configure({ mode: 'serial' });

// Serial groups retry as a unit; start every attempt from clean data.
test.beforeAll(async () => {
  const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) loadEnvFile(rootEnv);
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE "contact", "contact_list", "contact_list_member", "segment" CASCADE',
    );
  } finally {
    await client.end();
  }
});

test('seed contacts with attributes via CSV import', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'plans.csv', mimeType: 'text/csv', buffer: CSV });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported 3 contacts/)).toBeVisible({ timeout: 15_000 });
});

test('build a segment with live preview and save it', async ({ page }) => {
  await page.goto('/segments');
  await page.getByRole('button', { name: 'New segment' }).click();
  const editor = page.getByTestId('segment-editor');
  await editor.getByLabel('Name').fill('Paying customers');

  // Condition: attribute "plan" equals "pro".
  const row = editor.getByTestId('condition-row').first();
  await row.getByLabel('Property').selectOption('attribute');
  await row.getByLabel('Attribute name').fill('plan');
  await row.getByLabel('Operator').selectOption('equals');
  await row.getByLabel('Value', { exact: true }).fill('pro');
  await expect(page.getByTestId('segment-preview')).toContainText('1 contact matches', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('segment-preview')).toContainText('ada@example.com');

  // Widen with an OR group: plan equals trial.
  await editor.getByRole('button', { name: 'Add group' }).click();
  const nested = editor.getByTestId('condition-row').nth(1);
  await nested.getByLabel('Property').selectOption('attribute');
  await nested.getByLabel('Attribute name').fill('plan');
  await nested.getByLabel('Operator').selectOption('equals');
  await nested.getByLabel('Value', { exact: true }).fill('trial');
  await page.getByTestId('rule-root').getByLabel('Group operator').first().selectOption('or');
  await expect(page.getByTestId('segment-preview')).toContainText('2 contacts match');

  await page.getByRole('button', { name: 'Create segment', exact: true }).click();
  await expect(page.getByText('Segment created')).toBeVisible();
  const card = page.getByTestId('segment-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Paying customers');
  await expect(card).toContainText('2 members');
  await expect(card).toContainText('2 conditions');
});

test('edit the segment narrows membership', async ({ page }) => {
  await page.goto('/segments');
  await page.getByRole('button', { name: 'Paying customers', exact: true }).click();
  const editor = page.getByTestId('segment-editor');
  // Drop the OR branch (group + its condition) → back to plan=pro only.
  await editor.getByRole('button', { name: 'Remove group' }).click();
  await expect(page.getByTestId('segment-preview')).toContainText('1 contact matches', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Segment updated')).toBeVisible();
  await expect(page.getByTestId('segment-card')).toContainText('1 member');
});

test('delete the segment', async ({ page }) => {
  await page.goto('/segments');
  await page.getByRole('button', { name: 'Delete Paying customers' }).click();
  await expect(page.getByText('Segment deleted')).toBeVisible();
  await expect(page.getByTestId('segment-card')).toHaveCount(0);
});
