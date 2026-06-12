/* eslint-disable no-console -- operator-facing script */
/**
 * Regenerates tests/fixtures/crypto-envelope-vectors.json — the shared
 * cross-language contract for the vault envelope. The Node implementation
 * (src/crypto-envelope.ts) writes these vectors; both the vitest suite and
 * apps/intelligence's pytest suite replay the SAME file, so the byte
 * layout cannot drift between TypeScript and Python.
 *
 * Run only when the format changes:  pnpm exec tsx scripts/generate-vault-vectors.ts
 * Keys are derived from public labels — test fixtures, not secrets.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { encryptField, type VaultScope } from '../src/crypto-envelope';

async function testKey(label: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

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

function tamperCiphertext(envelope: string): string {
  const segments = envelope.split(':');
  const ct = segments[4]!;
  const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
  return [...segments.slice(0, 4), flipped, segments[5]!].join(':');
}

async function main() {
  const keyA = await testKey('helio-vault-test-key-a');
  const keyB = await testKey('helio-vault-test-key-b');
  const keyC = await testKey('helio-vault-test-key-c');
  const scope: VaultScope = {
    organizationId: 'org_vault_vectors',
    credentialId: 'cred_vault_vectors',
    field: 'apiKey',
  };

  const vectors: Vector[] = [];
  const ok = async (description: string, plaintext: string) => {
    vectors.push({
      description,
      key: keyA,
      previousKey: null,
      ...scope,
      plaintext,
      envelope: await encryptField(plaintext, scope, keyA),
      expect: 'ok',
    });
  };

  await ok('plain ascii secret', 'postmark-server-token-1234');
  await ok('empty string round-trips', '');
  await ok('unicode survives byte-exact', 'مرحبا 👋  — 秘密のキー');
  await ok('a 4 KiB value', 'k'.repeat(4096));

  vectors.push({
    description: 'previous key still opens envelopes during rotation',
    key: keyB,
    previousKey: keyA,
    ...scope,
    plaintext: 'sealed-under-the-old-key',
    envelope: await encryptField('sealed-under-the-old-key', scope, keyA),
    expect: 'ok',
  });

  vectors.push({
    description: 'tampered ciphertext fails authentication',
    key: keyA,
    previousKey: null,
    ...scope,
    plaintext: null,
    envelope: tamperCiphertext(await encryptField('tamper-me', scope, keyA)),
    expect: 'fail_tag',
  });

  vectors.push({
    description: 'envelope rebound to a different field fails (AAD)',
    key: keyA,
    previousKey: null,
    organizationId: scope.organizationId,
    credentialId: scope.credentialId,
    field: 'smtpPassword',
    plaintext: null,
    envelope: await encryptField('bound-to-apiKey', scope, keyA),
    expect: 'fail_aad',
  });

  vectors.push({
    description: 'envelope rebound to a different organization fails (AAD)',
    key: keyA,
    previousKey: null,
    organizationId: 'org_someone_else',
    credentialId: scope.credentialId,
    field: scope.field,
    plaintext: null,
    envelope: await encryptField('bound-to-the-vector-org', scope, keyA),
    expect: 'fail_aad',
  });

  vectors.push({
    description: 'an envelope sealed by an unknown key is refused by fingerprint',
    key: keyA,
    previousKey: keyB,
    ...scope,
    plaintext: null,
    envelope: await encryptField('sealed-under-key-c', scope, keyC),
    expect: 'fail_key',
  });

  vectors.push({
    description: 'malformed envelopes are rejected structurally',
    key: keyA,
    previousKey: null,
    ...scope,
    plaintext: null,
    envelope: 'enc:v1:not-an-envelope',
    expect: 'fail_format',
  });

  const file = path.resolve(import.meta.dirname, '../tests/fixtures/crypto-envelope-vectors.json');
  writeFileSync(file, `${JSON.stringify(vectors, null, 2)}\n`);
  console.log(`wrote ${vectors.length} vectors to ${file}`);
}

await main();
