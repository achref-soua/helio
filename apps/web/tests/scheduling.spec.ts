import { expect, test } from '@playwright/test';

// CRM scheduler: configure a booking page, book an open slot on the public
// page as an invitee, see the meeting land, then cancel it. Slot math and
// timezone correctness are covered by @helio/core's scheduling tests.

test('configure a booking page, book a meeting, then cancel it', async ({ page }) => {
  await page.goto('/scheduling');
  await expect(page.getByRole('heading', { name: 'Scheduling' })).toBeVisible();

  // Save the page with the defaults (Mon–Fri 09:00–17:00, 30 minutes).
  await page.getByTestId('sched-title').fill('Intro call');
  await page.getByTestId('sched-save').click();
  await expect(page.getByText('Booking page saved')).toBeVisible();

  // Grab the generated public booking link.
  const link = page.getByTestId('sched-copy-link');
  await expect(link).toBeVisible();
  const path = (await link.textContent())?.match(/\/m\/\S+/)?.[0];
  expect(path).toBeTruthy();

  // Book the first available slot as an invitee.
  await page.goto(path!);
  await expect(page.getByTestId('booking-form')).toBeVisible();
  await page.locator('#slot').click();
  await page.getByRole('option').first().click();
  await page.getByLabel('Your email').fill('invitee@example.com');
  await page.getByRole('button', { name: 'Book meeting' }).click();
  await expect(page.getByText("You're booked")).toBeVisible();

  // The meeting shows up in the dashboard; cancel it.
  await page.goto('/scheduling');
  const row = page.getByTestId('meeting-row').filter({ hasText: 'invitee@example.com' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Cancel the meeting/ }).click();
  await expect(page.getByText('Meeting canceled')).toBeVisible();
});
