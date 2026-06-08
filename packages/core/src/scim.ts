/**
 * SCIM 2.0 building blocks (RFC 7643/7644) for cross-vendor user
 * provisioning. Pure and runtime-agnostic — the web app's `/scim/v2`
 * handlers map Helio memberships through these. Tokens are hashed with Web
 * Crypto to stay consistent with the rest of @helio/core (no node:crypto).
 */

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** Content type SCIM clients expect on responses. */
export const SCIM_CONTENT_TYPE = 'application/scim+json';

/**
 * A Helio membership projected as a SCIM core User resource. Helio stores a
 * single display name, so SCIM's structured `name` is emitted as `formatted`.
 */
export interface ScimUserInput {
  /** Stable resource id — the membership id. */
  id: string;
  email: string;
  active: boolean;
  displayName?: string | null;
  createdAt?: Date | null;
}

export interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  displayName?: string;
  name?: { formatted: string };
  emails: Array<{ value: string; primary: boolean }>;
  active: boolean;
  meta: { resourceType: 'User'; location: string; created?: string };
}

/** Project a membership into a SCIM User. `location` is the resource URL. */
export function toScimUser(input: ScimUserInput, location: string): ScimUser {
  const display = input.displayName?.trim() || undefined;
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: input.id,
    userName: input.email,
    ...(display ? { displayName: display, name: { formatted: display } } : {}),
    emails: [{ value: input.email, primary: true }],
    active: input.active,
    meta: {
      resourceType: 'User',
      location,
      ...(input.createdAt ? { created: input.createdAt.toISOString() } : {}),
    },
  };
}

/**
 * Combine SCIM name parts (givenName/familyName/formatted) and userName into
 * the single display name Helio stores. Falls back to the email local-part.
 */
export function displayNameFromScimUser(body: unknown, email: string): string {
  const fallback = email.split('@')[0] ?? email;
  if (typeof body !== 'object' || body === null) return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.displayName === 'string' && record.displayName.trim()) {
    return record.displayName.trim();
  }
  const name = record.name;
  if (typeof name === 'object' && name !== null) {
    const { formatted, givenName, familyName } = name as Record<string, unknown>;
    if (typeof formatted === 'string' && formatted.trim()) return formatted.trim();
    const parts = [givenName, familyName].filter((p): p is string => typeof p === 'string' && !!p);
    if (parts.length) return parts.join(' ');
  }
  return fallback;
}

/** Wrap resources in a SCIM ListResponse. */
export function scimListResponse<T>(
  resources: T[],
  totalResults: number,
  startIndex = 1,
): {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
} {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/** A SCIM error body. `status` mirrors the HTTP status as a string. */
export function scimError(
  status: number,
  detail: string,
  scimType?: string,
): { schemas: string[]; status: string; detail: string; scimType?: string } {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  };
}

/**
 * Parse the single filter SCIM clients use before creating a user:
 * `userName eq "someone@acme.com"`. Returns the value, or null if the
 * filter is absent or not a userName-equality we support.
 */
export function parseUserNameFilter(filter: string | null | undefined): string | null {
  if (!filter) return null;
  const match = /^\s*userName\s+eq\s+"([^"]+)"\s*$/i.exec(filter);
  return match ? match[1]! : null;
}

interface PatchOperation {
  op?: string;
  path?: string;
  value?: unknown;
}

/** Coerce a SCIM boolean that may arrive as a real bool or a string. */
function coerceBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return null;
}

/**
 * Read the `active` flag a SCIM PatchOp is setting — this is how Okta and
 * Entra ID deactivate a user. Handles both shapes:
 *   { op: "replace", value: { active: false } }
 *   { op: "replace", path: "active", value: false }
 * Returns the boolean, or null when the patch doesn't touch `active`.
 */
export function activeFromPatch(body: unknown): boolean | null {
  if (typeof body !== 'object' || body === null) return null;
  const operations = (body as { Operations?: unknown }).Operations;
  if (!Array.isArray(operations)) return null;
  let result: boolean | null = null;
  for (const raw of operations as PatchOperation[]) {
    if (!raw || typeof raw !== 'object') continue;
    const op = typeof raw.op === 'string' ? raw.op.toLowerCase() : '';
    if (op !== 'replace' && op !== 'add') continue;
    if (typeof raw.path === 'string' && raw.path.toLowerCase() === 'active') {
      const coerced = coerceBool(raw.value);
      if (coerced !== null) result = coerced;
    } else if (raw.value && typeof raw.value === 'object' && 'active' in raw.value) {
      const coerced = coerceBool((raw.value as { active: unknown }).active);
      if (coerced !== null) result = coerced;
    }
  }
  return result;
}

/** The primary email from a SCIM User write payload (POST/PUT). */
export function emailFromScimUser(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.userName === 'string' && record.userName.includes('@')) {
    return record.userName.toLowerCase();
  }
  if (Array.isArray(record.emails)) {
    const primary =
      record.emails.find(
        (entry): entry is { value: string; primary?: boolean } =>
          !!entry && typeof entry === 'object' && (entry as { primary?: boolean }).primary === true,
      ) ?? record.emails[0];
    const value = (primary as { value?: unknown } | undefined)?.value;
    if (typeof value === 'string' && value.includes('@')) return value.toLowerCase();
  }
  return null;
}

/** `active` from a full SCIM User write payload (PUT). Defaults to true. */
export function activeFromScimUser(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return true;
  return coerceBool((body as { active?: unknown }).active) ?? true;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash a SCIM bearer token for storage/lookup. Only the hash is persisted. */
export function hashScimToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/**
 * Mint an opaque SCIM bearer token. Returns the plaintext (shown to the
 * admin once) and its hash (stored). The `scim_` prefix aids secret
 * scanners and operator recognition.
 */
export async function generateScimToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const token = `scim_${body}`;
  return { token, hash: await hashScimToken(token) };
}
