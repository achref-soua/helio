# ADR-0005: Temporal for durable journey execution

**Status:** accepted (implementation lands with Phase 1 journeys) · 2026-06-07

## Context

Customer journeys are long-lived (multi-week waits, event waits, retries) and must survive crashes and deploys with no double-sends.

## Decision

Temporal is the journey engine: workflows model journeys; activities perform sends; signals deliver events; versioned workflows handle journey edits. The compose `full` profile already runs Temporal + UI against the shared Postgres. Deployments that cannot carry Temporal will get a documented Inngest adapter behind the same internal interface — the journey domain code must not import Temporal types directly.

## Consequences

Heavier self-host footprint (accepted; profile-gated locally). Workflow tests will use Temporal's time-skipping test environment.
