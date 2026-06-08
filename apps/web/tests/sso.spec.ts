import { expect, test } from '@playwright/test';

// Enterprise SSO administration: an org admin registers an OIDC provider,
// sees it listed with its callback URL, and removes it. The IdP endpoints
// are pinned manually (skip discovery) so the flow needs no live identity
// provider — the OIDC handshake itself is Better-Auth's to own.

test('the SSO panel is visible on the settings page', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('sso-panel')).toBeVisible();
});

test('register an OIDC provider, see it listed, then remove it', async ({ page }) => {
  const unique = Date.now();
  const domain = `e2e-${unique}.example.com`;
  const providerId = `e2e-okta-${unique}`;

  await page.goto('/settings');
  const panel = page.getByTestId('sso-panel');
  await expect(panel).toBeVisible();

  await panel.getByTestId('sso-add').click();
  await page.getByTestId('sso-domain').fill(domain);
  await page.getByTestId('sso-provider-id').fill(providerId);
  await page.getByTestId('sso-issuer').fill('https://idp.example.com');
  await page.getByTestId('sso-client-id').fill('e2e-client-id');
  await page.getByTestId('sso-client-secret').fill('e2e-client-secret');

  // Pin endpoints manually so registration is a pure write (no discovery).
  await page.getByTestId('sso-manual-toggle').check();
  await page.getByTestId('sso-authorization-endpoint').fill('https://idp.example.com/authorize');
  await page.getByTestId('sso-token-endpoint').fill('https://idp.example.com/token');
  await page.getByTestId('sso-jwks-endpoint').fill('https://idp.example.com/jwks');

  await page.getByTestId('sso-submit').click();
  await expect(page.getByText('SSO provider added')).toBeVisible();

  // The provider appears with its domain and the IdP-facing callback URL.
  const row = page.getByTestId('sso-provider-row').filter({ hasText: domain });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`/api/auth/sso/callback/${providerId}`);

  // Remove it.
  await row.getByTestId('sso-remove').click();
  await expect(page.getByTestId('sso-provider-row').filter({ hasText: domain })).toHaveCount(0);
});
