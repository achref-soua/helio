# ADR-0022: Optional PgBouncer transaction pooling for the RLS app role

- Status: accepted
- Date: 2026-06-15

## Context

At scale, every Postgres connection costs memory and a backend process. The
gateway, dashboard, and intelligence service each run a connection pool against
the RLS-bound app role (`helio_app`); under horizontal scaling the product of
replicas × pool size can exhaust Postgres' `max_connections`. The standard
answer is a transaction-mode connection pooler (PgBouncer) in front of Postgres,
which multiplexes many client connections onto a few server connections.

Transaction pooling is only safe if nothing the application relies on outlives a
single transaction on a server connection — session state set on one client's
transaction must not bleed into the next client that reuses that server
connection. Helio's tenant isolation is exactly such state: every tenant query
runs inside a transaction that sets `app.org_id` via
`set_config('app.org_id', …, true)` (TS `forTenant`, Python `Database.scoped`),
and the RLS policies read it with `current_setting('app.org_id')`. The `true`
third argument makes the setting **transaction-local**, so it is discarded at
commit/abort — precisely the property transaction pooling requires.

By contrast, the admin role connection (migrations, the auth kernel) uses
session-level features (advisory locks, prepared statements, `SET` without
`LOCAL`) and must keep a **direct** connection.

## Decision

Offer PgBouncer in **transaction** mode as an **opt-in** pooler for the
`helio_app` connection only; the admin connection stays direct.

- A `pgbouncer` service (its own compose profile; a Helm-friendly sidecar) sits
  between the app role and Postgres. Operators enable it by adding the
  `pgbouncer` profile and pointing the app role at it
  (`HELIO_APP_DB_HOST=pgbouncer`, `HELIO_APP_DB_PORT=6432`). Defaults keep the
  direct connection, so existing deployments are unchanged.
- The TS data layer needs no change: Prisma runs on the `node-postgres` driver
  adapter, which uses unnamed (per-transaction) prepared statements that are
  compatible with transaction pooling.
- The Python data layer disables asyncpg's statement cache
  (`statement_cache_size=0`) when `INTEL_DATABASE_PGBOUNCER=true`, because
  server-side prepared statements do not survive pooled transactions.
- `DATABASE_ADMIN_URL` always points straight at Postgres.

## Validation

Verified against a live Postgres with the production schema and RLS, through
PgBouncer in transaction mode (scram-sha-256 auth):

1. Without the GUC, `SELECT count(*) FROM organization` returns `0` — RLS hides
   every row.
2. Inside a transaction that runs `set_config('app.org_id', <org>, true)`, the
   same query returns exactly that org's row.
3. The next query on the **pooled** connection returns `0` again — the GUC was
   transaction-scoped and did not leak to the connection's next client.

Step 3 is the safety property transaction pooling demands; it holds by
construction because of the transaction-local GUC.

## Consequences

- Far fewer Postgres backends under horizontal scale, without weakening tenant
  isolation: RLS is enforced identically with or without the pooler.
- Opt-in keeps the default (direct) path and the auto-update flow risk-free.
- Throughput gains are deployment-specific and should be measured on the target
  hardware; this ADR establishes correctness, not a benchmark.
