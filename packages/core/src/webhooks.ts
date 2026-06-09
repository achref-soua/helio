import { z } from 'zod';

/** The Temporal workflow that durably delivers one webhook event. */
export const WEBHOOK_DELIVERY_WORKFLOW = 'webhookDeliveryWorkflow';

/** The domain events an outbound webhook endpoint can subscribe to. */
export const WEBHOOK_EVENTS = [
  'contact.created',
  'deal.created',
  'deal.won',
  'deal.lost',
  'task.completed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);

const encoder = new TextEncoder();

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A signing secret for a new endpoint: `whsec_<43 base64url chars>`. */
export function generateWebhookSecret(): string {
  return `whsec_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/**
 * Sign a webhook body. Returns the `x-helio-signature` header value
 * `t=<unix>,v1=<hmac>` — the timestamp is inside the MAC, so a captured
 * delivery cannot be replayed under a different timestamp.
 */
export async function signWebhookPayload(
  secret: string,
  body: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const signature = await hmacHex(secret, `${timestampSeconds}.${body}`);
  return `t=${timestampSeconds},v1=${signature}`;
}

/**
 * Verify a signature header against the body and secret, rejecting anything
 * outside the freshness window. Mirrors {@link signWebhookPayload} and is the
 * reference a consumer (or the SDKs) implements.
 */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parts = new Map(
    header.split(',').map((kv) => {
      const index = kv.indexOf('=');
      return [kv.slice(0, index), kv.slice(index + 1)] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const provided = parts.get('v1');
  if (!provided || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return timingSafeEqual(expected, provided);
}

/** Length-constant string compare, to keep signature checks off the timing side channel. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** The enabled endpoints subscribed to `event`. Pure. */
export function endpointsForEvent<T extends { enabled: boolean; events: string[] }>(
  endpoints: readonly T[],
  event: WebhookEvent,
): T[] {
  return endpoints.filter((endpoint) => endpoint.enabled && endpoint.events.includes(event));
}
