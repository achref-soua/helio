import type { EventBusProducer } from '@helio/bus';

export type { EventBusProducer } from '@helio/bus';

/** What the handlers need to know about a send. */
export interface ResolvedSend {
  organizationId: string;
  workspaceId: string;
  contactId: string;
  email: string;
  campaignId: string | null;
  variant: string | null;
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
