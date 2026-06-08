# Single sign-on (OIDC)

Helio supports enterprise single sign-on with any OpenID Connect identity
provider (Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak, …).
Providers are configured **per organization** and selected by email domain:
a user who signs in with `you@acme.com` is routed to Acme's IdP.

There is nothing to enable at the server level — SSO is on by default and
becomes active for an organization as soon as an admin registers a provider.

## Register a provider

1. In your IdP, create an **OIDC application** (a "Web" / "confidential"
   client). Set the redirect/callback URL to:

   ```
   https://<your-helio-host>/api/auth/sso/callback/<provider-id>
   ```

   `<provider-id>` is any short slug you choose (e.g. `acme-okta`); Helio
   shows the exact URL back to you after you save.

2. In Helio, open **Settings → Single sign-on → Add provider** (requires the
   `owner` or `admin` role) and fill in:

   | Field             | Value                                                |
   | ----------------- | ---------------------------------------------------- |
   | **Email domain**  | The domain whose users sign in here, e.g. `acme.com` |
   | **Provider ID**   | The slug from step 1, e.g. `acme-okta`               |
   | **Issuer URL**    | Your IdP's issuer, e.g. `https://acme.okta.com`      |
   | **Client ID**     | From the OIDC application                            |
   | **Client secret** | From the OIDC application                            |

   Helio discovers the authorization, token, and JWKS endpoints from
   `<issuer>/.well-known/openid-configuration`. If your IdP has no discovery
   document, tick **Set endpoints manually** and provide them.

3. Save. The provider is bound to your current organization and listed with
   its callback URL.

## Sign in

On the login page, members enter their work email and choose **Sign in with
SSO**. Helio matches the domain to your provider and redirects to the IdP;
on return, first-time users are provisioned into the organization as a
`viewer`, which an admin can elevate under **Settings → Members**.

## Security model

- A provider is bound to the organization of the admin who registered it.
  Org binding is enforced server-side — a client can never attach a provider
  to an organization it doesn't administer.
- The OIDC **client secret is never exposed** by the API and never readable
  by the tenant-scoped database role: the `sso_provider` table is part of the
  auth domain and walled off from the RLS plane (ADR-0004, ADR-0013).
- Manual endpoints must be publicly routable, or their origin added to the
  server's trusted origins — an SSRF guard rejects private hosts.

See [ADR-0013](adr/0013-sso-oidc.md) for the design rationale.
