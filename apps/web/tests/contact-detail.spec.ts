import { expect, test } from '@playwright/test';

/**
 * The contact detail page (H2): created → opened from the table → notes
 * round-trip → timeline degrades politely without the analytics store.
 */

test('contact detail shows the profile and notes round-trip', async ({ page }) => {
  const email = `detail-${Date.now()}@example.com`;
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Add contact' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('First name').fill('Detail');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByRole('button', { name: 'Create contact' }).click();
  await expect(page.getByText(email)).toBeVisible();

  // The email cell links to the detail page.
  await page.getByRole('link', { name: email }).click();
  await expect(page.getByTestId('contact-detail')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Detail Tester' })).toBeVisible();
  await expect(page.getByTestId('contact-scores')).toBeVisible();

  // Notes: add → pinned toggle → delete.
  await page.getByLabel('New note').fill('Met at the conference — wants a demo.');
  await page.getByRole('button', { name: 'Add note' }).click();
  const note = page.getByTestId('contact-note').filter({ hasText: 'wants a demo' });
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Pin note' }).click();
  await expect(note.getByRole('button', { name: 'Unpin note' })).toBeVisible();
  await note.getByRole('button', { name: 'Delete note' }).click();
  await expect(note).toHaveCount(0);

  // Timeline: ClickHouse is off in this profile — the page says so and
  // still shows the Postgres-side trail (the creation audit entry).
  await expect(page.getByTestId('contact-timeline')).toContainText('analytics store');
  await expect(page.getByTestId('contact-timeline')).toContainText('contact.created');
});
