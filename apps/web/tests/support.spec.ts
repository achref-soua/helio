import { expect, test } from '@playwright/test';

// Bug reports are filed entirely server-side — a GitHub issue when a token is
// configured, and always an email to the support inbox (Mailpit in the dev
// stack). With no PAT configured (the default), the report is delivered by
// email, so filing one shows a confirmation and closes the dialog — there is no
// browser hand-off to GitHub's new-issue page. We stub window.open to prove no
// tab is ever popped.

test('filing a report submits server-side and confirms — no browser hand-off', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = (url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    };
  });

  await page.goto('/');
  await page.getByTestId('report-open').click();
  // The dialog names the target repo (the deployment default upstream repo).
  await expect(page.getByRole('dialog')).toContainText('achref-soua/helio');

  await page.getByTestId('report-subject').fill('Export button does nothing');
  await page.getByTestId('report-body').fill('Clicking export on /contacts is a no-op.');
  await page.getByTestId('report-submit').click();

  // A confirmation appears and the dialog closes — no manual GitHub submit step.
  await expect(page.getByText(/Report sent/)).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();

  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(0);
});

test('settings shows the GitHub repo and the notification email, not an inbox', async ({
  page,
}) => {
  await page.goto('/settings');
  const panel = page.getByTestId('support-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('GitHub');
  await expect(panel.getByTestId('support-repo')).toBeVisible();
  await expect(panel.getByTestId('support-email')).toBeVisible();
  // The old triage inbox is gone.
  await expect(page.getByTestId('support-row')).toHaveCount(0);
});
