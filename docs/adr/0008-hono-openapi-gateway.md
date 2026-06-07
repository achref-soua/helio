# ADR-0008: Hono + zod-openapi public gateway

**Status:** accepted · 2026-06-07

## Context

The dashboard talks tRPC (in-process types), but external consumers need a stable, documented REST surface.

## Decision

`apps/api` is a Hono app with `@hono/zod-openapi`: Zod schemas generate OpenAPI 3.1; the committed `openapi.json` is contract-tested against the running app so drift fails the build. Errors are RFC 9457 problem+json everywhere; POSTs honor Idempotency-Key (Redis replay); a Redis fixed-window limiter emits standard RateLimit headers. Phase 0 authenticates with a single bootstrap bearer token (timing-safe compare); per-user scoped Better-Auth API keys replace it when the public surface ships.

## Consequences

Two API styles by design: tRPC for our UI, REST for the world. The generated spec later feeds the public SDKs.
