import { encryptField, generateEncryptionKey } from '@helio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = generateEncryptionKey();
const OTHER_KEY = generateEncryptionKey();

vi.mock('../src/env', () => ({ env: { HELIO_ENCRYPTION_KEY: '' } }));

import {
  clearCredentialCache,
  type CredentialReader,
  resolveOrgCredential,
} from '../src/credential-store';
import { env } from '../src/env';

function readerFor(row: Awaited<ReturnType<CredentialReader['providerCredential']['findFirst']>>) {
  const findFirst = vi.fn().mockResolvedValue(row);
  return { db: { providerCredential: { findFirst } } satisfies CredentialReader, findFirst };
}

async function sealedRow(orgId: string, key: string) {
  const id = 'cred_test_1';
  return {
    id,
    organizationId: orgId,
    kind: 'EMAIL_POSTMARK',
    name: 'Production',
    config: { fromEmail: 'hello@acme.test' },
    secrets: {
      serverToken: await encryptField(
        'pm-secret-token',
        { organizationId: orgId, credentialId: id, field: 'serverToken' },
        key,
      ),
    },
    status: 'VERIFIED',
  };
}

describe('resolveOrgCredential', () => {
  beforeEach(() => {
    clearCredentialCache();
    (env as { HELIO_ENCRYPTION_KEY?: string }).HELIO_ENCRYPTION_KEY = KEY;
  });
  afterEach(() => vi.clearAllMocks());

  it('decrypts the org credential and caches the resolution', async () => {
    const { db, findFirst } = readerFor(await sealedRow('org_a', KEY));
    const first = await resolveOrgCredential(db, 'org_a', ['EMAIL_POSTMARK']);
    expect(first?.secrets.serverToken).toBe('pm-secret-token');
    expect(first?.config.fromEmail).toBe('hello@acme.test');

    await resolveOrgCredential(db, 'org_a', ['EMAIL_POSTMARK']);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns null (env fallback) when the org has no credential', async () => {
    const { db } = readerFor(null);
    expect(await resolveOrgCredential(db, 'org_a', ['EMAIL_SMTP'])).toBeNull();
  });

  it('returns null when the vault key is missing or cannot open the row', async () => {
    const { db } = readerFor(await sealedRow('org_a', KEY));
    (env as { HELIO_ENCRYPTION_KEY?: string }).HELIO_ENCRYPTION_KEY = undefined;
    expect(await resolveOrgCredential(db, 'org_a', ['EMAIL_POSTMARK'])).toBeNull();

    clearCredentialCache();
    (env as { HELIO_ENCRYPTION_KEY?: string }).HELIO_ENCRYPTION_KEY = OTHER_KEY;
    expect(await resolveOrgCredential(db, 'org_a', ['EMAIL_POSTMARK'])).toBeNull();
  });
});
