import type { EnrichedEvent } from '@helio/core';

/** Broker-agnostic producer boundary (ADR-0007). */
export interface EventBusProducer {
  publish(events: EnrichedEvent[]): Promise<void>;
}

/** What the handlers need to know about a send. */
export interface ResolvedSend {
  organizationId: string;
  workspaceId: string;
  contactId: string;
  email: string;
  campaignId: string | null;
}

export interface SendResolver {
  resolve(sendId: string): Promise<ResolvedSend | null>;
}

export interface TrackingDeps {
  sends: SendResolver;
  producer: EventBusProducer;
  secret: string;
  readiness?: Record<string, () => Promise<void>>;
  now?: () => Date;
}
