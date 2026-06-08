import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { mintUnsubscribeToken } from '@helio/core';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';

test.describe.configure({ mode: 'serial' });

let unsubscribeContactId: string;

// Seed campaign prerequisites directly: the template/segment builder
// journeys own their UI coverage; this spec covers campaign flows.
test.beforeAll(async () => {
  const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) loadEnvFile(rootEnv);
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE "campaign", "email_send", "email_template", "segment", "contact", "contact_list", "contact_list_member" CASCADE',
    );
    const { rows: workspaces } = await client.query<{ id: string; organization_id: string }>(
      'SELECT id, organization_id FROM workspace LIMIT 1',
    );
    const ws = workspaces[0]!;
    await client.query(
      `INSERT INTO email_template (id, organization_id, workspace_id, name, subject, document, updated_at)
       VALUES ('tpl_e2e_campaigns', $1, $2, 'Launch email', 'Hello!', $3, now())`,
      [
        ws.organization_id,
        ws.id,
        JSON.stringify({
          blocks: [{ id: 'b1', type: 'paragraph', text: 'Hi {{firstName|there}}' }],
        }),
      ],
    );
    await client.query(
      `INSERT INTO segment (id, organization_id, workspace_id, name, rule, updated_at)
       VALUES ('seg_e2e_campaigns', $1, $2, 'Everyone active', $3, now())`,
      [
        ws.organization_id,
        ws.id,
        JSON.stringify({
          kind: 'group',
          op: 'and',
          children: [{ kind: 'condition', target: 'status', operator: 'equals', value: 'ACTIVE' }],
        }),
      ],
    );
    unsubscribeContactId = 'contact_e2e_unsub';
    await client.query(
      `INSERT INTO contact (id, organization_id, workspace_id, email, first_name, updated_at)
       VALUES ($1, $2, $3, 'optout@example.com', 'Opt', now())`,
      [unsubscribeContactId, ws.organization_id, ws.id],
    );
  } finally {
    await client.end();
  }
});

test('create a campaign from a template and a segment', async ({ page }) => {
  await page.goto('/campaigns');
  await page.getByRole('button', { name: 'New campaign' }).click();
  await page.getByLabel('Name').fill('Product launch');
  await page.getByLabel('Template').selectOption({ label: 'Launch email' });
  await page.getByLabel('Audience').selectOption({ label: 'Segment: Everyone active' });
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await expect(page.getByText('Campaign created')).toBeVisible();

  const card = page.getByTestId('campaign-card');
  await expect(card).toContainText('Product launch');
  await expect(card).toContainText('Draft');
  await expect(card).toContainText('Launch email');
  await expect(card).toContainText('Segment: Everyone active');
});

test('sending without Temporal explains the precondition', async ({ page }) => {
  // The e2e stack runs the core profile only — the launch button must
  // fail actionably, not silently.
  await page.goto('/campaigns');
  await page.getByRole('button', { name: 'Send Product launch' }).click();
  await expect(page.getByText(/Temporal is unreachable/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('campaign-card')).toContainText('Draft');
});

test('draft campaigns can be deleted', async ({ page }) => {
  await page.goto('/campaigns');
  await page.getByRole('button', { name: 'Delete Product launch' }).click();
  await expect(page.getByText('Campaign deleted')).toBeVisible();
  await expect(page.getByTestId('campaign-card')).toHaveCount(0);
});

test('the unsubscribe page flips the contact and is idempotent', async ({ browser }) => {
  const secret = process.env.UNSUBSCRIBE_SECRET!;
  const token = await mintUnsubscribeToken(secret, unsubscribeContactId);

  // Email recipients are anonymous — no session cookie.
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  await page.goto(`/u/${encodeURIComponent(token)}`);
  await expect(page.getByText('optout@example.com')).toBeVisible();
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByText("You're unsubscribed")).toBeVisible();

  // Revisiting shows the already-unsubscribed state.
  await page.goto(`/u/${encodeURIComponent(token)}`);
  await expect(page.getByText("You're unsubscribed")).toBeVisible();
  await anonymous.close();
});

test('tampered unsubscribe tokens are rejected', async ({ page }) => {
  await page.goto('/u/contact_e2e_unsub.bogus-signature');
  await expect(page.getByText('Link not recognized')).toBeVisible();
});

test('one-click unsubscribe endpoint accepts provider POSTs', async ({ request }) => {
  const secret = process.env.UNSUBSCRIBE_SECRET!;
  const token = await mintUnsubscribeToken(secret, unsubscribeContactId);
  const response = await request.post(`/u/${encodeURIComponent(token)}/one-click`, {
    form: { 'List-Unsubscribe': 'One-Click' },
  });
  expect(response.status()).toBe(200);
});
