import { expect, test } from '@playwright/test';

// Bug reports go to GitHub, not an in-app inbox. With no PAT configured (the
// default), filing a report opens a prefilled new-issue page — we stub
// window.open so the test stays hermetic (no real github.com navigation).

test('filing a report opens a prefilled GitHub issue', async ({ page }) => {
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
  await expect(page.getByText('Opening GitHub')).toBeVisible();

  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  const url = new URL(opened[0]!);
  expect(url.origin + url.pathname).toBe('https://github.com/achref-soua/helio/issues/new');
  expect(url.searchParams.get('title')).toBe('Export button does nothing');
  expect(url.searchParams.get('labels')).toBe('bug');
});

test('settings shows the GitHub target, not an inbox', async ({ page }) => {
  await page.goto('/settings');
  const panel = page.getByTestId('support-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('GitHub');
  await expect(panel.getByTestId('support-repo')).toBeVisible();
  // The old triage inbox is gone.
  await expect(page.getByTestId('support-row')).toHaveCount(0);
});
