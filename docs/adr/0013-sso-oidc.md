# ADR-0013: Per-organization OIDC single sign-on

**Status:** accepted · 2026-06-08

## Context

Enterprise buyers expect to bring their own identity provider, and a multi-tenant platform can't ship one global IdP: each organization authenticates against its own (Okta, Entra ID, Google Workspace, Auth0…). We already run Better-Auth as the auth kernel (ADR-0004), so SSO should extend it rather than introduce a second identity stack.

## Decision

Adopt the Better-Auth **SSO plugin** for OIDC, registered **per organization** and routed by email domain. An org admin registers a provider (issuer + client credentials; endpoints are auto-discovered, or pinned manually for IdPs without a discovery document); a user signing in with `you@acme.com` is matched to Acme's provider and handed off. On return they're provisioned into that org as the least-privileged `viewer` (ADR-0004 role set), which an admin elevates.

Two guardrails matter:

- **Org binding is server-authoritative.** The `sso` tRPC router runs on `orgProcedure`, gates every call behind `admin`, and passes the _verified_ active-org id to `registerSSOProvider` — a client can never register a provider for an org it doesn't administer. Reads omit `oidc_config` (the client secret).
- **The provider table is auth-domain.** `sso_provider` holds the OIDC client secret, so like the rest of the identity tables its grant is revoked from `helio_app` (`sso_provider_lockdown` migration). The RLS plane cannot read SSO secrets even by accident; the kernel reaches the table through the admin connection only.

## Consequences

Domain-routed OIDC with no per-tenant configuration in code, and a clean path to SCIM (a provider already binds users to an org). SAML is available in the same plugin but deferred. Better-Auth's `organizationProvisioning.defaultRole` only types Better-Auth's built-in roles, so Helio's `viewer` is asserted at the call site (written verbatim to `member.role`). The full OIDC handshake is the plugin's to own and is exercised upstream; Helio's tests cover registration, org-scoping, secret lockdown, and removal.
