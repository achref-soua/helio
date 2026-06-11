import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  decryptField,
  encryptField,
  generateEncryptionKey,
  isEnvelope,
  keyFingerprint,
  parseEnvelope,
  VaultDecryptError,
  VaultFormatError,
  VaultKeyUnknownError,
  type VaultScope,
} from '../src/crypto-envelope';

interface Vector {
  description: string;
  key: string;
  previousKey: string | null;
  organizationId: string;
  credentialId: string;
  field: string;
  plaintext: string | null;
  envelope: string;
  expect: 'ok' | 'fail_tag' | 'fail_aad' | 'fail_key' | 'fail_format';
}

const vectors = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'fixtures/crypto-envelope-vectors.json'), 'utf8'),
) as Vector[];

const scope: VaultScope = { organizationId: 'org_a', credentialId: 'cred_1', field: 'apiKey' };

describe('crypto envelope', () => {
  it('round-trips plaintext under a fresh key', async () => {
    const key = generateEncryptionKey();
    const envelope = await encryptField('twilio-auth-token-xyz', scope, key);
    expect(isEnvelope(envelope)).toBe(true);
    expect(envelope).toMatch(/^enc:v1:[0-9a-f]{8}:/);
    await expect(decryptField(envelope, scope, key)).resolves.toBe('twilio-auth-token-xyz');
  });

  it('every encryption uses a fresh iv', async () => {
    const key = generateEncryptionKey();
    const first = await encryptField('same', scope, key);
    const second = await encryptField('same', scope, key);
    expect(first).not.toBe(second);
  });

  it('binds to the organization, credential, and field (AAD)', async () => {
    const key = generateEncryptionKey();
    const envelope = await encryptField('secret', scope, key);
    await expect(decryptField(envelope, { ...scope, field: 'other' }, key)).rejects.toBeInstanceOf(
      VaultDecryptError,
    );
    await expect(
      decryptField(envelope, { ...scope, organizationId: 'org_b' }, key),
    ).rejects.toBeInstanceOf(VaultDecryptError);
    await expect(
      decryptField(envelope, { ...scope, credentialId: 'cred_2' }, key),
    ).rejects.toBeInstanceOf(VaultDecryptError);
  });

  it('accepts the previous key during rotation, by fingerprint', async () => {
    const oldKey = generateEncryptionKey();
    const newKey = generateEncryptionKey();
    const envelope = await encryptField('rotating', scope, oldKey);
    await expect(decryptField(envelope, scope, newKey, oldKey)).resolves.toBe('rotating');
    await expect(decryptField(envelope, scope, newKey)).rejects.toBeInstanceOf(
      VaultKeyUnknownError,
    );
  });

  it('rejects malformed keys and envelopes structurally', async () => {
    await expect(encryptField('x', scope, 'dG9vLXNob3J0')).rejects.toBeInstanceOf(VaultFormatError);
    expect(() => parseEnvelope('enc:v2:aabbccdd:a:a:a')).toThrowError(VaultFormatError);
    expect(isEnvelope('not-an-envelope')).toBe(false);
    expect(isEnvelope(42)).toBe(false);
  });

  it('mints distinct 32-byte keys with stable fingerprints', async () => {
    const key = generateEncryptionKey();
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
    expect(await keyFingerprint(key)).toBe(await keyFingerprint(key));
    expect(await keyFingerprint(key)).not.toBe(await keyFingerprint(generateEncryptionKey()));
  });
});

describe('cross-language vectors (shared with apps/intelligence)', () => {
  it('has both success and every failure mode covered', () => {
    const kinds = new Set(vectors.map((vector) => vector.expect));
    expect(kinds).toEqual(new Set(['ok', 'fail_tag', 'fail_aad', 'fail_key', 'fail_format']));
  });

  for (const vector of vectors) {
    it(vector.description, async () => {
      const vectorScope: VaultScope = {
        organizationId: vector.organizationId,
        credentialId: vector.credentialId,
        field: vector.field,
      };
      const attempt = decryptField(
        vector.envelope,
        vectorScope,
        vector.key,
        vector.previousKey ?? undefined,
      );
      switch (vector.expect) {
        case 'ok':
          await expect(attempt).resolves.toBe(vector.plaintext);
          break;
        case 'fail_tag':
        case 'fail_aad':
          await expect(attempt).rejects.toBeInstanceOf(VaultDecryptError);
          break;
        case 'fail_key':
          await expect(attempt).rejects.toBeInstanceOf(VaultKeyUnknownError);
          break;
        case 'fail_format':
          await expect(attempt).rejects.toBeInstanceOf(VaultFormatError);
          break;
      }
    });
  }
});
