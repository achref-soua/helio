import { expect, test } from '@playwright/test';

// SCIM 2.0 provisioning: an admin mints a bearer token, then an identity
// provider (here, Playwright's request context) lists, creates, and
// deactivates members through /scim/v2 — authenticated only by the token.

const SCIM = '/scim/v2';

test('mint a SCIM token and drive provisioning through /scim/v2', async ({ page, request }) => {
  // 1. Generate the token in the dashboard and capture the one-time reveal.
  await page.goto('/settings');
  await expect(page.getByTestId('scim-panel')).toBeVisible();
  await page.getByTestId('scim-generate').click();
  await expect(page.getByTestId('scim-token')).toBeVisible();
  const token = (await page.getByTestId('scim-token').textContent())?.trim();
  expect(token).toMatch(/^scim_/);
  await page.getByRole('button', { name: 'Done' }).click();
  // The badge waits on a status refetch; a cold dev server compiling routes
  // on demand can push that round-trip past the default expect timeout.
  await expect(page.getByTestId('scim-configured')).toBeVisible({ timeout: 15_000 });

  const auth = { Authorization: `Bearer ${token}` };

  // 2. Discovery is unauthenticated and advertises PATCH + filtering.
  const config = await request.get(`${SCIM}/ServiceProviderConfig`);
  expect(config.status()).toBe(200);
  expect((await config.json()).patch.supported).toBe(true);

  // 3. The org owner is already a member, so the list is non-empty.
  const list = await request.get(`${SCIM}/Users`, { headers: auth });
  expect(list.status()).toBe(200);
  const listBody = await list.json();
  expect(listBody.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
  expect(listBody.totalResults).toBeGreaterThanOrEqual(1);

  // 4. Provision a new user.
  const email = `scim-${Date.now()}@example.com`;
  const created = await request.post(`${SCIM}/Users`, {
    headers: auth,
    data: {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: email,
      name: { givenName: 'Sky', familyName: 'Walker' },
      active: true,
    },
  });
  expect(created.status()).toBe(201);
  const createdBody = await created.json();
  expect(createdBody.userName).toBe(email);
  expect(createdBody.active).toBe(true);
  const id: string = createdBody.id;

  // 5. Re-provisioning the same userName is a conflict.
  const dup = await request.post(`${SCIM}/Users`, {
    headers: auth,
    data: { userName: email },
  });
  expect(dup.status()).toBe(409);

  // 6. Find by filter (the IdP's de-dupe probe).
  const found = await request.get(
    `${SCIM}/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`,
    { headers: auth },
  );
  expect((await found.json()).totalResults).toBe(1);

  // 7. Deactivate → membership removed → the resource is gone.
  const patched = await request.patch(`${SCIM}/Users/${id}`, {
    headers: auth,
    data: {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', value: { active: false } }],
    },
  });
  expect(patched.status()).toBe(200);
  expect((await patched.json()).active).toBe(false);

  const gone = await request.get(`${SCIM}/Users/${id}`, { headers: auth });
  expect(gone.status()).toBe(404);
});

test('SCIM endpoints reject requests without a bearer token', async ({ request }) => {
  const res = await request.get(`${SCIM}/Users`);
  expect(res.status()).toBe(401);
  expect(res.headers()['www-authenticate']).toContain('Bearer');
});
