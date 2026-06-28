import { expect, test } from '@playwright/test';

import { fillStable, openDialog } from './dialog';

// CRM scheduler: configure a booking page, book an open slot on the public
// page as an invitee, see the meeting land, then cancel it. Slot math and
// timezone correctness are covered by @helio/core's scheduling tests.

test('configure a booking page, book a meeting, then cancel it', async ({ page }) => {
  await page.goto('/scheduling');
  await expect(page.getByRole('heading', { name: 'Scheduling' })).toBeVisible();

  // Save the page with the defaults (Mon–Fri 09:00–17:00, 30 minutes). Saving is
  // a client mutation, so retry the click until the confirmation toast shows —
  // a click that lands before the panel hydrates is otherwise a silent no-op.
  await fillStable(page.getByTestId('sched-title'), 'Intro call');
  await openDialog(page.getByTestId('sched-save'), page.getByText('Booking page saved'));

  // The generated public booking link is rendered verbatim once the page exists.
  const link = page.getByTestId('sched-public-link');
  await expect(link).toBeVisible();
  const path = (await link.textContent())?.match(/\/m\/\S+/)?.[0];
  expect(path).toBeTruthy();

  // Book the first available slot as an invitee. The slot picker is a custom
  // dropdown, so open it with the same retry-until-visible guard.
  await page.goto(path!);
  await expect(page.getByTestId('booking-form')).toBeVisible();
  await openDialog(page.locator('#slot'), page.getByRole('option').first());
  await page.getByRole('option').first().click();
  await page.getByLabel('Your email').fill('invitee@example.com');
  await page.getByRole('button', { name: 'Book meeting' }).click();
  await expect(page.getByText("You're booked")).toBeVisible();

  // The meeting shows up in the dashboard; cancel it (also a client mutation).
  await page.goto('/scheduling');
  const row = page.getByTestId('meeting-row').filter({ hasText: 'invitee@example.com' });
  await expect(row).toBeVisible();
  await openDialog(
    row.getByRole('button', { name: /Cancel the meeting/ }),
    page.getByText('Meeting canceled'),
  );
});
