/**
 * Stateless unsubscribe tokens: `contactId.signature`, HMAC-bound with
 * a dedicated secret. No expiry — an unsubscribe link in an old email
 * must keep working, legally and practically.
 */

const encoder = new TextEncoder();

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintUnsubscribeToken(secret: string, contactId: string): Promise<string> {
  return `${contactId}.${await hmac(secret, contactId)}`;
}

/** Returns the contactId when the token verifies, null otherwise. */
export async function verifyUnsubscribeToken(
  secret: string,
  token: string,
): Promise<string | null> {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const contactId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = await hmac(secret, contactId);
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0 ? contactId : null;
}

export function unsubscribeUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/u/${encodeURIComponent(token)}`;
}

/** Temporal wiring shared by the dashboard (client) and apps/workers. */
export const SENDS_TASK_QUEUE = 'helio-sends';
export const CAMPAIGN_SEND_WORKFLOW = 'campaignSendWorkflow';
export const JOURNEY_RUN_WORKFLOW = 'journeyRunWorkflow';
