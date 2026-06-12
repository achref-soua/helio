import { type CredentialKind, credentialSpec, decryptField, type LlmProvider } from '@helio/core';

import { env } from './env';

/**
 * Per-organization provider credential resolution for the send pipeline
 * (ADR-0019). Workers run on the trusted admin connection, so reads
 * filter by organization explicitly; secrets decrypt here and only here,
 * immediately before a send. Resolutions cache briefly so journey fan-out
 * doesn't hammer Postgres; absent rows mean "fall back to the deployment
 * env config" (the pre-vault behavior).
 */

export interface ResolvedCredential {
  id: string;
  kind: CredentialKind;
  name: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

interface CredentialRow {
  id: string;
  organizationId: string;
  kind: string;
  name: string;
  config: unknown;
  secrets: unknown;
  status: string;
}

export interface CredentialReader {
  providerCredential: {
    findFirst(args: {
      where: { organizationId: string; kind: { in: string[] } };
      orderBy: ReadonlyArray<Record<string, 'asc' | 'desc'>>;
    }): Promise<CredentialRow | null>;
  };
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: ResolvedCredential | null }>();

/** Test seam: drop all cached resolutions. */
export function clearCredentialCache(): void {
  cache.clear();
}

/**
 * Resolve the org's credential for any of `kinds` (verified rows win,
 * then most recently updated) and decrypt its secrets. Returns null when
 * the org has none configured or the vault key is absent — callers fall
 * back to env-configured providers.
 */
export async function resolveOrgCredential(
  db: CredentialReader,
  organizationId: string,
  kinds: CredentialKind[],
): Promise<ResolvedCredential | null> {
  const cacheKey = `${organizationId}:${kinds.join(',')}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await load(db, organizationId, kinds);
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function load(
  db: CredentialReader,
  organizationId: string,
  kinds: CredentialKind[],
): Promise<ResolvedCredential | null> {
  const key = env.HELIO_ENCRYPTION_KEY;
  if (!key) return null;

  const row = await db.providerCredential.findFirst({
    where: { organizationId, kind: { in: kinds } },
    // VERIFIED sorts after FAILED/UNVERIFIED alphabetically — desc puts
    // verified first; ties break on recency.
    orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
  });
  if (!row) return null;

  const kind = row.kind as CredentialKind;
  const stored = (row.secrets ?? {}) as Record<string, string>;
  const secrets: Record<string, string> = {};
  for (const field of credentialSpec(kind).secretFields) {
    const envelope = stored[field.name];
    if (!envelope) continue;
    // A decrypt failure (rotated/foreign key) must not break sending —
    // the caller falls back to the env provider.
    try {
      secrets[field.name] = await decryptField(
        envelope,
        { organizationId, credentialId: row.id, field: field.name },
        key,
        env.HELIO_ENCRYPTION_KEY_PREVIOUS,
      );
    } catch {
      return null;
    }
  }
  return {
    id: row.id,
    kind,
    name: row.name,
    config: (row.config ?? {}) as Record<string, unknown>,
    secrets,
  };
}

/** Convenience typing for LLM rows (used by later batches). */
export interface LlmCredentialConfig {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
}
