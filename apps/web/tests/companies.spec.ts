import { expect, test } from '@playwright/test';

/**
 * Companies (H4): create from the list page, attach to a contact from
 * its detail page, and watch the counts land back on the company row.
 */

test('create a company and attach a contact to it', async ({ page }) => {
  const company = `Acme ${Date.now()}`;
  const email = `acct-${Date.now()}@example.com`;

  await page.goto('/companies');
  await expect(page.getByTestId('companies-view')).toBeVisible();
  await page.getByRole('button', { name: 'Add company' }).click();
  await page.getByLabel('Name').fill(company);
  await page.getByLabel('Domain').fill('acme.example');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByTestId('company-row').filter({ hasText: company })).toBeVisible();

  // Make a contact and attach it from the detail page.
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Add contact' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Create contact' }).click();
  await page.getByRole('link', { name: email }).click();
  await expect(page.getByTestId('contact-detail')).toBeVisible();
  await page.getByLabel('Company', { exact: true }).selectOption({ label: company });
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue(/co_/);

  // The company row counts the attachment.
  await page.goto('/companies');
  const row = page.getByTestId('company-row').filter({ hasText: company });
  await expect(row).toContainText('acme.example');
  await expect(row.locator('td').nth(3)).toHaveText('1');
});
