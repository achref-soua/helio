/**
 * Per-organization API keys for the public REST gateway. The key embeds the
 * organization id (`hk_<orgId>.<secret>`) so the gateway can set the RLS
 * tenant context *before* it touches the database — it stays bound to the
 * unprivileged app role, never an admin connection. The embedded org is not
 * trusted on its own: only the SHA-256 hash of the whole key is stored, so
 * tampering with the org segment changes the hash and fails the lookup.
 */

const PREFIX = 'hk_';

export interface GeneratedApiKey {
  /** The full secret, shown to the operator exactly once. */
  key: string;
  /** SHA-256 hex of `key`; the only thing persisted. */
  keyHash: string;
  /** A non-secret leading fragment for listing keys in the UI. */
  prefix: string;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash a gateway API key for storage and lookup. */
export function hashGatewayApiKey(key: string): Promise<string> {
  return sha256Hex(key);
}

/** Mint a key bound to an organization. Returns the secret, its hash, and a display prefix. */
export async function generateGatewayApiKey(organizationId: string): Promise<GeneratedApiKey> {
  const secret = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const key = `${PREFIX}${organizationId}.${secret}`;
  return {
    key,
    keyHash: await hashGatewayApiKey(key),
    prefix: `${PREFIX}${organizationId}.${secret.slice(0, 6)}…`,
  };
}

/**
 * Extract the claimed organization id from a presented key, or null if the
 * shape is wrong. The claim is verified by the hash lookup under that org's
 * RLS context — a forged org segment simply won't match any stored hash.
 */
export function parseGatewayApiKey(key: string): { organizationId: string } | null {
  if (!key.startsWith(PREFIX)) return null;
  const dot = key.indexOf('.');
  if (dot <= PREFIX.length) return null;
  const organizationId = key.slice(PREFIX.length, dot);
  const secret = key.slice(dot + 1);
  if (!organizationId || !secret) return null;
  return { organizationId };
}

// ── API key scopes (M2) ─────────────────────────────────────────────────────

/** The grantable scopes; '*' (the default) grants everything. */
export const API_SCOPES = [
  'contacts:read',
  'contacts:write',
  'lists:read',
  'lists:write',
  'workspaces:read',
  'workspaces:write',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/**
 * Does a key's scope list allow the needed scope? `*` is the legacy/full
 * grant; a `<resource>:write` grant implies its `:read`.
 */
export function scopeAllows(scopes: string[], needed: ApiScope): boolean {
  if (scopes.includes('*') || scopes.includes(needed)) return true;
  const [resource, action] = needed.split(':');
  return action === 'read' && scopes.includes(`${resource}:write`);
}
