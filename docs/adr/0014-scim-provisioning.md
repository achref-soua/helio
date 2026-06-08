# ADR-0014: SCIM 2.0 provisioning against the auth kernel

**Status:** accepted · 2026-06-08

## Context

SSO (ADR-0013) authenticates whoever an org's IdP sends, but enterprises also expect lifecycle provisioning: when HR adds or offboards someone, the IdP should create or revoke the Helio membership automatically. The standard is SCIM 2.0 (RFC 7643/7644). The question is where it runs — the REST gateway (`apps/api`) is RLS-bound and deliberately cannot touch identity tables, while SCIM's whole job is to write them.

## Decision

SCIM runs in the dashboard app (`apps/web`) at `/scim/v2`, against the **auth kernel's admin client** — the same trust boundary as SSO and the rest of the identity domain (ADR-0004). It is not added to the RLS gateway.

- **Token, not session.** Each org mints one **SCIM bearer token** (Settings → SCIM). Only its SHA-256 hash is stored, in a `scim_token` table revoked from the RLS app role (`scim_token_lockdown`). Every `/scim/v2` request resolves the token → org; an IdP only ever sees its own org. The auth proxy lets `/scim` through (bearer-authenticated, no cookie).
- **A SCIM User is a membership.** `POST /Users` finds-or-creates the Helio user by email and adds a `viewer` membership (idempotent on org+email → 409). `PATCH active:false`, `PUT active:false`, and `DELETE` all remove the membership — Helio has no "inactive membership" state, and revoking access is the security-critical behavior. The underlying user (which may belong to other orgs) is left intact. Provision/deprovision are audit-logged.
- **Pure logic in `@helio/core`.** SCIM serialization, filter parsing, PatchOp interpretation (incl. Entra's stringified booleans), and token hashing live in `core/scim.ts` and are unit-tested; the route handlers stay thin and are exercised end-to-end via Playwright's request context.

## Consequences

Okta/Entra can drive Helio membership lifecycle with a token and a base URL. Groups (role mapping) and an "inactive but queryable" user state are deferred — deactivation removes the membership today. Co-locating a machine API with the dashboard is justified by its identity-domain nature; it shares the kernel's admin connection and audit trail rather than widening the gateway's privileges.
