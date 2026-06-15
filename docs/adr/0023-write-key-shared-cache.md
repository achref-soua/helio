# ADR-0023: A shared L2 cache for write-key resolution

- Status: accepted
- Date: 2026-06-15

## Context

Event ingestion is the highest-throughput path in Helio (target ≥5k events/s).
Every request resolves a write key to its `{organizationId, workspaceId}` before
the event is accepted. That resolution was cached in-process (an L1 TTL map),
which keeps Postgres off the hot path within a warm replica — but a cold or
freshly-scaled replica, and any working set larger than the in-process bound,
still hit Postgres on the write-key lookup.

A shared cache would let every replica reuse a resolution. The hazard with any
cache in a multi-tenant system is a cross-tenant leak, so the cache key must be
unambiguous about which tenant a value belongs to.

## Decision

Add an optional **shared Redis L2** behind the existing in-process L1, in the
ingest write-key resolver.

- **Tenant-safe by construction.** The cache key is the write key itself
  (`wk:<key>`). A write key is globally unique and maps to exactly one
  workspace, so there is no org/workspace prefix to get wrong and no way for one
  tenant's value to be served for another's key.
- **Two tiers.** L1 (in-process) is consulted first; on a miss, L2 (Redis); on a
  miss there, Postgres, which then populates both tiers.
- **Fail-open.** Any L2 error (Redis down, corrupt value) is swallowed and the
  resolver falls through to Postgres — a cache problem never produces a wrong
  answer, only a slower one.
- **Negative caching** is kept (flood protection) but with a short L2 TTL (5s)
  so a freshly-created key is not masked across replicas, while the positive TTL
  matches L1 (60s). Revocation propagates within the TTL, which the existing
  design already deemed acceptable for an analytics write credential.

## Deferred

Org-scoped entity caches (contact-by-id, segment membership) were considered.
They require an `org:<id>:…`-prefixed key and invalidation on every mutation
path across multiple services; a missed prefix or invalidation is a correctness
or isolation bug. They are deferred until their throughput benefit can be
measured on reference hardware and the invalidation is proven, rather than
shipped on a security/perf release without that validation. The write-key cache
is the safe, highest-leverage first step (it sits on the busiest path and cannot
leak across tenants).

## Consequences

- Cold and horizontally-scaled replicas resolve write keys from Redis instead of
  Postgres, cutting database load on the busiest path; warm replicas are
  unchanged (L1 still answers first).
- The cache is opt-in at the wiring level (the resolver works L1-only when no L2
  is supplied), keeping the unit tests and any minimal deployment simple.
- Throughput gains are deployment-specific and should be measured on the target
  hardware.
