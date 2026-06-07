# ADR-0003: Tenant isolation via Postgres row-level security

**Status:** accepted · 2026-06-07

## Context

Multi-tenant data isolation enforced only by query discipline (`where organizationId = …`) fails open: one forgotten filter leaks tenants.

## Decision

Postgres enforces isolation. Runtime traffic connects as `helio_app` (`NOBYPASSRLS`); every tenant table carries `ENABLE`+`FORCE ROW LEVEL SECURITY` policies keyed on the transaction-local `app.org_id` setting. `forTenant(prisma, orgId)` wraps every operation in a transaction that sets the GUC first. Migrations and seeds use the admin role (schema owner).

## Consequences

Cross-tenant reads/writes/updates/deletes are impossible for the app role — proven by integration tests against real Postgres (no context ⇒ zero rows; foreign ids ⇒ null/denied). Costs one extra round-trip per operation (batched transaction), revisited when profiling demands.
