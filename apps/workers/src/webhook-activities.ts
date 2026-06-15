import { lookup } from 'node:dns/promises';

import { assertPublicUrl, signWebhookPayload, type WebhookEvent } from '@helio/core';

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

export interface WebhookActivityOptions {
  /**
   * Allow delivery to private/loopback/link-local addresses (a LAN webhook
   * receiver). Off by default; set HELIO_ALLOW_PRIVATE_WEBHOOKS=true to opt in.
   */
  allowPrivate?: boolean;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to a `node:dns` lookup (all A/AAAA records). */
  resolve?: (hostname: string) => Promise<string[]>;
}

const dnsResolve = (hostname: string): Promise<string[]> =>
  lookup(hostname, { all: true }).then((records) => records.map((record) => record.address));

/**
 * Deliver one webhook event. The destination URL is operator-supplied, so it is
 * SSRF-checked (see @helio/core `assertPublicUrl`) before anything is signed or
 * sent — this stops a webhook endpoint pointed at the deployment's own network
 * (loopback, RFC1918, `169.254.169.254`) from turning a worker into a confused
 * deputy. The body is then HMAC-signed with the endpoint's own secret; a non-2xx
 * response throws so the Temporal retry policy backs off and tries again.
 */
export function createWebhookActivities(options: WebhookActivityOptions = {}): WebhookActivities {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolve = options.resolve ?? dnsResolve;
  const allowPrivate = options.allowPrivate ?? false;
  return {
    async deliverWebhookEvent(input) {
      await assertPublicUrl(input.url, { allowPrivate, resolve });
      const body = JSON.stringify({
        id: input.eventId,
        type: input.eventType,
        occurredAt: input.occurredAt,
        data: input.data,
      });
      const signature = await signWebhookPayload(input.secret, body);
      const response = await fetchImpl(input.url, {
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
