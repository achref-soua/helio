import { signWebhookPayload, type WebhookEvent } from '@helio/core';

/** One outbound delivery: everything the activity needs to sign and POST. */
export interface WebhookDeliveryInput {
  endpointId: string;
  url: string;
  /** The endpoint's own HMAC signing secret. */
  secret: string;
  eventId: string;
  eventType: WebhookEvent;
  /** ISO-8601 instant the event occurred. */
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface WebhookActivities {
  deliverWebhookEvent(input: WebhookDeliveryInput): Promise<void>;
}

/**
 * Deliver one webhook event. The body is HMAC-signed with the endpoint's own
 * secret (see @helio/core `signWebhookPayload`); a non-2xx response throws so
 * the Temporal retry policy backs off and tries again.
 */
export function createWebhookActivities(): WebhookActivities {
  return {
    async deliverWebhookEvent(input) {
      const body = JSON.stringify({
        id: input.eventId,
        type: input.eventType,
        occurredAt: input.occurredAt,
        data: input.data,
      });
      const signature = await signWebhookPayload(input.secret, body);
      const response = await fetch(input.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Helio-Webhooks/1.0',
          'x-helio-event': input.eventType,
          'x-helio-delivery': input.eventId,
          'x-helio-signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`webhook ${input.url} answered ${response.status}`);
      }
    },
  };
}
