# ADR-0015: Per-organization API keys for the public gateway

**Status:** accepted · 2026-06-08

## Context

The REST gateway (`apps/api`, ADR-0008) shipped with a Phase-0 bootstrap **service token**: one shared secret, with the caller naming the `organizationId` on every request. That is fine for smoke tests but wrong for a public API — any token holder could act on any organization. Real external callers (and the SDKs that will wrap them) need credentials scoped to a single org.

The gateway connects only as the RLS-bound app role (it never holds an admin connection — ADR-0003/0004). That creates a bootstrapping problem: resolving a credential to its tenant happens _before_ a tenant context exists, yet the credential table can only be read with one set.

## Decision

Introduce **per-organization API keys** of the form `hk_<organizationId>.<secret>`, stored as a SHA-256 hash in an RLS **domain** table (`gateway_api_key`).

The embedded org id resolves the bootstrapping problem without an admin connection: the middleware parses it, sets that org's RLS context, then looks the key up **by the hash of the whole presented string**. Two independent walls protect this:

- The stored hash covers the entire key, so tampering with the org segment changes the hash and matches nothing.
- The table's RLS policy scopes the lookup to the claimed org, so a hash can only ever resolve within its own tenant.

On success the verified org is placed on the request context; handlers scope by it and **no endpoint takes an `organizationId` parameter** anymore. Keys are minted in Settings (owner/admin), shown once, and revocable. The bootstrap token, its env var, and the old bearer middleware are removed.

## Consequences

The gateway is now a real multi-tenant API and the foundation for generated SDKs, while staying entirely on the unprivileged DB role. Keys are coarse (whole-org, no per-scope permissions yet) — scopes and expiry are a future extension. Embedding the org id makes keys longer and surfaces the (non-secret) org id; acceptable, and it's what keeps the resolver admin-free. This is a distinct credential from Better-Auth's user-scoped API keys and the SCIM token, each serving a different surface.
