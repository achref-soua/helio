import { createECDH, randomBytes } from 'node:crypto';

/**
 * Secret generation for `helio install` — every value a fresh deployment
 * needs, from node:crypto alone (the CLI ships with zero runtime
 * dependencies).
 */

export function generateHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/** URL/connection-string-safe password (no quoting hazards). */
export function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

/** The vault key: base64 (standard) of exactly 32 random bytes. */
export function generateVaultKey(): string {
  return randomBytes(32).toString('base64');
}

export interface VapidPair {
  publicKey: string;
  privateKey: string;
}

/**
 * A VAPID (RFC 8292) P-256 key pair: base64url uncompressed public point
 * (65 bytes) and base64url private scalar (32 bytes) — the format web-push
 * libraries and browsers expect.
 */
export function generateVapidPair(): VapidPair {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}
