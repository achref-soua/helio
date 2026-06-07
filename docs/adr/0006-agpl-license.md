# ADR-0006: AGPL-3.0 license

**Status:** accepted · 2026-06-07

## Context

Helio is open-source and self-hostable; the main commercial risk is closed-source SaaS forks.

## Decision

AGPL-3.0-only: network-service modifications must be published. Permissive licenses (MIT/Apache-2.0) were rejected for the platform itself; public SDKs may be licensed permissively later so integrating with Helio never inherits copyleft.

## Consequences

Some enterprises avoid AGPL dependencies — acceptable: Helio is an application you run, not a library you link.
