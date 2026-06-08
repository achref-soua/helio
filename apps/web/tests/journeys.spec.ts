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
    await client.query('TRUNCATE "journey", "journey_run", "email_template" CASCADE');
    const { rows } = await client.query<{ id: string; organization_id: string }>(
      'SELECT id, organization_id FROM workspace LIMIT 1',
    );
    const ws = rows[0]!;
    await client.query(
      `INSERT INTO email_template (id, organization_id, workspace_id, name, subject, document, updated_at)
       VALUES ('tpl_e2e_journeys', $1, $2, 'Welcome mail', 'Hello!', $3, now())`,
      [
        ws.organization_id,
        ws.id,
        JSON.stringify({
          blocks: [{ id: 'b1', type: 'paragraph', text: 'Hi {{firstName|there}}' }],
        }),
      ],
    );
  } finally {
    await client.end();
  }
});

test('build a journey on the canvas and save it', async ({ page }) => {
  await page.goto('/journeys');
  await page.getByRole('button', { name: 'New journey' }).click();
  await page.getByLabel('Name').fill('Welcome series');

  // The trigger node is on the canvas; name the enrolling event.
  await page.getByLabel('Trigger event').fill('Signed Up');
  await expect(page.getByTestId('journey-issues')).toContainText('connect');

  // Palette buttons append and auto-wire from the open end.
  await page.getByRole('button', { name: 'Send email', exact: true }).click();
  await page
    .getByTestId('node-send')
    .getByLabel('Template')
    .selectOption({ label: 'Welcome mail' });
  await page.getByRole('button', { name: 'Wait', exact: true }).click();
  await page.getByTestId('node-wait').getByLabel('Wait duration (hours)').fill('48');
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByTestId('journey-issues')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save journey' }).click();
  await expect(page.getByText('Journey created')).toBeVisible();
  const card = page.getByTestId('journey-card');
  await expect(card).toContainText('Welcome series');
  await expect(card).toContainText('Draft');
  await expect(card).toContainText('On “Signed Up” · 3 steps');
});

test('activate, pause, and guard deletion', async ({ page }) => {
  await page.goto('/journeys');
  await page.getByRole('button', { name: 'Activate Welcome series' }).click();
  await expect(page.getByText('Journey activated')).toBeVisible();
  const card = page.getByTestId('journey-card');
  await expect(card).toContainText('Active');
  // Active journeys hide the delete button entirely.
  await expect(card.getByRole('button', { name: 'Delete Welcome series' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pause Welcome series' }).click();
  await expect(page.getByText('Journey paused')).toBeVisible();
  await expect(card).toContainText('Paused');
});

test('reopen the saved journey and verify the graph restores', async ({ page }) => {
  await page.goto('/journeys');
  await page.getByRole('button', { name: 'Welcome series', exact: true }).click();
  await expect(page.getByTestId('journey-canvas')).toBeVisible();
  await expect(page.getByLabel('Trigger event')).toHaveValue('Signed Up');
  await expect(page.getByTestId('node-send').getByLabel('Template')).toHaveValue(
    'tpl_e2e_journeys',
  );
  await expect(page.getByTestId('node-wait').getByLabel('Wait duration (hours)')).toHaveValue('48');
  await expect(page.getByTestId('journey-issues')).toHaveCount(0);
});

test('v2: A/B split, trait, webhook nodes and settings persist', async ({ page }) => {
  await page.goto('/journeys');
  await page.getByRole('button', { name: 'New journey' }).click();
  await page.getByLabel('Name').fill('Variant test');
  await page.getByLabel('Trigger event').fill('Trial Started');

  // ab_split auto-wires its a edge to the next palette node, then b.
  await page.getByRole('button', { name: 'A/B split', exact: true }).click();
  await page.getByTestId('node-ab-split').getByLabel('Percent to A').fill('30');
  await page.getByRole('button', { name: 'Update trait', exact: true }).click();
  await page.getByTestId('node-update-trait').getByLabel('Trait name').fill('variant');
  await page.getByTestId('node-update-trait').getByLabel('Trait value').fill('a');
  await page.getByRole('button', { name: 'Webhook', exact: true }).click();
  await page
    .getByTestId('node-webhook')
    .getByLabel('Webhook URL')
    .fill('https://hooks.example.com/variant-b');
  await page.getByRole('button', { name: 'Web push', exact: true }).click();
  await page
    .getByTestId('node-send-push')
    .getByLabel('Notification title')
    .fill('Your order shipped');
  await page.getByTestId('node-send-push').getByLabel('Notification body').fill('Track it now');
  await page.getByRole('button', { name: 'End', exact: true }).click();
  // trait branch (a) still dangles → wire it by adding another End.
  await page.getByRole('button', { name: 'End', exact: true }).click();

  // Journey-level delivery settings.
  await page.getByLabel('Quiet hours').check();
  await page.getByLabel('Frequency cap').check();
  await page.getByLabel('Max emails').fill('2');

  await expect(page.getByTestId('journey-issues')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save journey' }).click();
  await expect(page.getByText('Journey created')).toBeVisible();

  // Reopen → everything round-trips.
  await page.getByRole('button', { name: 'Variant test', exact: true }).click();
  await expect(page.getByTestId('node-ab-split').getByLabel('Percent to A')).toHaveValue('30');
  await expect(page.getByTestId('node-update-trait').getByLabel('Trait name')).toHaveValue(
    'variant',
  );
  await expect(page.getByTestId('node-webhook').getByLabel('Webhook URL')).toHaveValue(
    'https://hooks.example.com/variant-b',
  );
  await expect(page.getByTestId('node-send-push').getByLabel('Notification title')).toHaveValue(
    'Your order shipped',
  );
  await expect(page.getByLabel('Quiet hours')).toBeChecked();
  await expect(page.getByLabel('Max emails')).toHaveValue('2');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Delete Variant test' }).click();
  await expect(page.getByText('Journey deleted')).toBeVisible();
});

test('delete the paused journey', async ({ page }) => {
  await page.goto('/journeys');
  await page.getByRole('button', { name: 'Delete Welcome series' }).click();
  await expect(page.getByText('Journey deleted')).toBeVisible();
  await expect(page.getByTestId('journey-card')).toHaveCount(0);
});
