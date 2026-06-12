import { decryptField, encryptField, isEnvelope } from '@helio/core';

import { env } from './env';

/**
 * Row-bound sealing for secrets that live on domain tables outside the
 * credential vault (integration signing secrets, DKIM private keys). Same
 * enc:v1 envelope, with the row id taking the credential-id slot in the
 * AAD — a value copied onto another row fails authentication.
 */

export function vaultReady(): boolean {
  return Boolean(env.HELIO_ENCRYPTION_KEY);
}

function requireKey(): string {
  if (!env.HELIO_ENCRYPTION_KEY) {
    throw new Error('HELIO_ENCRYPTION_KEY is not configured on this deployment');
  }
  return env.HELIO_ENCRYPTION_KEY;
}

export async function sealRowSecret(
  organizationId: string,
  rowId: string,
  field: string,
  plaintext: string,
): Promise<string> {
  return encryptField(plaintext, { organizationId, credentialId: rowId, field }, requireKey());
}

/** Opens sealed values; legacy plaintext (pre-vault rows) passes through. */
export async function openRowSecret(
  organizationId: string,
  rowId: string,
  field: string,
  stored: string,
): Promise<string> {
  if (!isEnvelope(stored)) return stored;
  return decryptField(
    stored,
    { organizationId, credentialId: rowId, field },
    requireKey(),
    env.HELIO_ENCRYPTION_KEY_PREVIOUS,
  );
}
