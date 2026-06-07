/**
 * Signed tracking links. The click redirector is an open redirect by
 * design, so every target URL is HMAC-bound to its send: tampering with
 * `u` invalidates `s`. WebCrypto keeps this isomorphic (senders run in
 * Node workers; verification runs in the tracking service).
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
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signClickTarget(
  secret: string,
  sendId: string,
  targetUrl: string,
): Promise<string> {
  return hmac(secret, `${sendId}\n${targetUrl}`);
}

export async function verifyClickTarget(
  secret: string,
  sendId: string,
  targetUrl: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmac(secret, `${sendId}\n${targetUrl}`);
  if (expected.length !== signature.length) return false;
  // Constant-time-ish comparison; payloads are short.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/** The pixel URL embedded at the bottom of tracked HTML emails. */
export function openPixelUrl(trackingBaseUrl: string, sendId: string): string {
  return `${trackingBaseUrl.replace(/\/+$/, '')}/o/${encodeURIComponent(sendId)}.gif`;
}

/** The wrapped click-through URL for a link in a tracked email. */
export async function clickRedirectUrl(
  trackingBaseUrl: string,
  secret: string,
  sendId: string,
  targetUrl: string,
): Promise<string> {
  const signature = await signClickTarget(secret, sendId, targetUrl);
  const base = trackingBaseUrl.replace(/\/+$/, '');
  return `${base}/c/${encodeURIComponent(sendId)}?u=${encodeURIComponent(targetUrl)}&s=${signature}`;
}
