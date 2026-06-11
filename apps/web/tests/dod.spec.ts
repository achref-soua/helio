import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;

async function mailLink(request: APIRequestContext, to: string, pattern: RegExp) {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = await request.get(`${MAILPIT}/api/v1/search?query=to:${to}`);
        const { messages } = (await list.json()) as { messages: Array<{ ID: string }> };
        if (!messages?.length) return false;
        const message = await request.get(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
        const { Text } = (await message.json()) as { Text: string };
        link = Text.match(pattern)?.[0];
        return Boolean(link);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return link!;
}

async function signupAndVerify(page: Page, request: APIRequestContext, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Invited Member');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  const verifyLink = await mailLink(request, email, /https?:\/\/\S+verify-email\S+/);
  await page.goto(verifyLink);
}

/**
 * Phase 0 Definition of Done: an owner can invite a teammate; the teammate
 * can sign up, accept, and log in scoped to the organization — and domain
 * write access respects roles end to end.
 */
test('owner invites a teammate who joins as viewer', async ({ page, browser, request }) => {
  const memberEmail = `e2e-member-${Date.now()}@example.com`;

  // Owner (authenticated via the setup project) sends a viewer invitation.
  await page.goto('/settings');
  await expect(page.getByText('Members', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Invite' }).click();
  // exact: the credentials empty-state on this page exposes a select
  // labeled "Add a Email sending credential", which substring-matches.
  await page.getByLabel('Email', { exact: true }).fill(memberEmail);
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('menuitem', { name: 'Viewer' }).click();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent')).toBeVisible();
  await expect(page.getByText(memberEmail)).toBeVisible();

  // The invited teammate signs up, verifies, and accepts in a fresh browser.
  const memberContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const memberPage = await memberContext.newPage();
  const inviteLink = await mailLink(request, memberEmail, /https?:\/\/\S+accept-invitation\S+/);

  await signupAndVerify(memberPage, request, memberEmail);
  await memberPage.goto(inviteLink);
  await expect(memberPage.getByText("You're invited")).toBeVisible();
  await memberPage.getByRole('button', { name: 'Accept invitation' }).click();
  // A first-time member lands in the product tour (modal — it hides the
  // page from the accessibility tree); skip it the way a real user would.
  await memberPage.getByTestId('tour-skip').click();
  await expect(memberPage.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // Scoped to the org: settings shows both members; the viewer cannot manage.
  await memberPage.goto('/settings');
  await expect(memberPage.getByText('E2E Operator')).toBeVisible();
  await expect(memberPage.getByText('Invited Member')).toBeVisible();
  await expect(memberPage.getByRole('button', { name: 'Invite' })).toHaveCount(0);

  // Role enforcement reaches the API: a viewer cannot create workspaces.
  const denied = await memberPage.request.post('/api/trpc/workspace.create?batch=1', {
    data: { 0: { json: { name: 'Sneaky', slug: 'sneaky' } } },
  });
  const payload = JSON.stringify(await denied.json());
  expect(payload).toContain('FORBIDDEN');

  // The admin area is hidden from viewers — and the server gate holds even
  // when the URL is typed by hand.
  await expect(
    memberPage.getByRole('navigation', { name: 'Primary' }).getByText('Admin'),
  ).toHaveCount(0);
  await memberPage.goto('/admin/audit');
  await expect(memberPage.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await memberContext.close();
});
