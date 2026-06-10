import { expect, test } from '@playwright/test';

// Operator CSV export and the per-contact GDPR data bundle. Reuses whatever
// contacts exist (creating one if the table is empty) — read-only besides
// that, so it never disturbs the serial contacts suite.

const EMAIL = `export-${Date.now()}@example.com`;

test('export contacts as CSV and one contact as a GDPR JSON bundle', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Add contact' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(EMAIL);
  await dialog.getByLabel('First name').fill('Exporter');
  await page.getByRole('button', { name: 'Create contact' }).click();
  await expect(page.getByRole('cell', { name: EMAIL })).toBeVisible({ timeout: 15_000 });

  // 1. CSV export honors the current view and downloads a parseable file.
  const csvDownload = page.waitForEvent('download');
  await page.getByTestId('export-contacts').click();
  const csv = await (await csvDownload).createReadStream();
  const csvText = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    csv.on('data', (chunk: Buffer) => chunks.push(chunk));
    csv.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    csv.on('error', reject);
  });
  expect(csvText.split('\r\n')[0]).toContain('email,first_name');
  expect(csvText).toContain(EMAIL);

  // 2. The data bundle carries the profile and the (possibly degraded)
  //    event timeline marker.
  const row = page.getByRole('row', { name: new RegExp(EMAIL) });
  await row.getByRole('button', { name: 'Contact actions' }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByTestId('export-contact-data').click();
  const json = await (await jsonDownload).createReadStream();
  const jsonText = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    json.on('data', (chunk: Buffer) => chunks.push(chunk));
    json.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    json.on('error', reject);
  });
  const bundle = JSON.parse(jsonText) as {
    contact: { email: string; listMembers: unknown[] };
    eventsUnavailable: boolean;
  };
  expect(bundle.contact.email).toBe(EMAIL);
  expect(Array.isArray(bundle.contact.listMembers)).toBe(true);
  expect(typeof bundle.eventsUnavailable).toBe('boolean');
});
