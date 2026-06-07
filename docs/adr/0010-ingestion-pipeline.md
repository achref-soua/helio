# ADR-0010: Ingestion pipeline — write keys, at-least-once, ReplacingMergeTree

**Status:** accepted · 2026-06-08

## Context

Phase 1 needs behavioral events flowing from customer properties into the
analytical store (ADR-0007 fixed the stores: Redpanda as the bus, ClickHouse
as the event table). Open questions were the auth model for a public browser
endpoint, the delivery contract, and how schema-on-write stays manageable.

## Decision

**Write keys, not user auth.** Ingestion authenticates with per-workspace
write keys (`write_key` table). A write key is a _client-visible_ credential:
it only grants appending events into one workspace's stream, never reads.
Keys arrive as a Basic-auth username (Segment convention), a Bearer token,
an `X-Write-Key` header, or in the body — the last because `sendBeacon`
cannot set headers. CORS is wide open on the endpoint; the key is the
gate, not the origin.

**Key lookup over the admin connection.** Key → workspace resolution is
cross-tenant by nature, so it cannot run under the RLS app role. The ingest
service uses the admin connection restricted (by code and review) to the
`write_key` table, with an in-process TTL cache (60 s, negative caching) so
Postgres stays off the hot path. Dashboard key management goes through the
normal RLS-bound tRPC path.

**At-least-once, deduplicated by the table engine.** The HTTP layer enriches
(server `received_at`, generated `message_id` when absent) and produces to
Redpanda keyed by workspace; the sink consumer commits offsets only after a
successful ClickHouse insert. Failures therefore redeliver, and the `events`
table is `ReplacingMergeTree(received_at)` ordered by
`(workspace_id, timestamp, message_id)`, so redelivered rows collapse during
merges. Readers that need exactness before merges use `FINAL` or
`GROUP BY message_id`; campaign analytics tolerates merge lag.

**One process by default.** The sink runs inside the ingest process
(`INGEST_SINK_ENABLED`), keeping the self-hosted footprint at one container;
operators can split it out for scale. Consumer-side poison messages are
logged and dropped rather than blocking the partition.

## Consequences

Revocation propagates within the cache TTL per instance — acceptable for an
append-only analytics credential. Identical events re-sent with different
client timestamps survive as distinct rows; the dedup contract is
`message_id` + client timestamp. The migration runner is single-statement-
per-file by design (no SQL parsing).
