import type { EnrichedEvent } from '@helio/core';

/**
 * Broker-agnostic producer boundary (ADR-0007): Redpanda today via the
 * Kafka protocol, swappable without touching call sites.
 */
export interface EventBusProducer {
  publish(events: EnrichedEvent[]): Promise<void>;
}
