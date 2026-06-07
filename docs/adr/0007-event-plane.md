# ADR-0007: ClickHouse + Redpanda event plane

**Status:** accepted (implementation lands with Phase 1 ingestion) · 2026-06-07

## Context

Behavioral events arrive in firehose volumes and power segments, funnels, and attribution. Postgres is the wrong store for that read/write pattern.

## Decision

Redpanda (Kafka-compatible, single-binary) is the event backbone behind a producer/consumer interface (swappable for Kafka). ClickHouse is the analytical store for tracked events and send/engagement telemetry. Postgres remains the transactional source of truth. Both already run in the compose `full` profile.

## Consequences

Two more stateful services, profile-gated in dev. The abstraction boundary keeps Phase 1 ingestion code broker-agnostic.
