import { describe, expect, it } from 'vitest';

import {
  generateHex,
  generatePassword,
  generateVapidPair,
  generateVaultKey,
} from '../src/lib/secrets';

describe('secret generation', () => {
  it('mints hex secrets of the requested byte length', () => {
    expect(generateHex(32)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateHex(24)).toMatch(/^[0-9a-f]{48}$/);
    expect(generateHex(32)).not.toBe(generateHex(32));
  });

  it('mints url-safe passwords (no quoting hazards in connection strings)', () => {
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('mints a vault key that decodes to exactly 32 bytes', () => {
    expect(Buffer.from(generateVaultKey(), 'base64')).toHaveLength(32);
  });

  it('mints a vapid p-256 pair in the web-push wire format', () => {
    const pair = generateVapidPair();
    const publicKey = Buffer.from(pair.publicKey, 'base64url');
    const privateKey = Buffer.from(pair.privateKey, 'base64url');
    expect(publicKey).toHaveLength(65);
    expect(publicKey[0]).toBe(0x04); // uncompressed point
    expect(privateKey.length).toBeGreaterThanOrEqual(31);
    expect(privateKey.length).toBeLessThanOrEqual(32);
  });
});
