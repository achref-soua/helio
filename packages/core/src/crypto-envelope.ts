/**
 * Encryption-at-rest envelope for per-organization provider credentials
 * (ADR-0019). Values are sealed with AES-256-GCM under the deployment's
 * `HELIO_ENCRYPTION_KEY` and stored as a single string:
 *
 *   enc:v1:<keyfp8>:<iv_b64>:<ct_b64>:<tag_b64>
 *
 * - `keyfp8` — first 8 hex chars of SHA-256(raw key); identifies which key
 *   sealed the value so rotation can keep a previous key live.
 * - The AAD binds the ciphertext to its organization, credential row, and
 *   field name — a copied envelope fails authentication anywhere else.
 *
 * The format is implemented twice — here on Web Crypto and in
 * apps/intelligence on python-cryptography — and both sides replay the
 * committed vectors in tests/fixtures/crypto-envelope-vectors.json, so the
 * byte layout cannot drift between languages.
 */

const PREFIX = 'enc';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** The envelope string is structurally wrong (not produced by this module). */
export class VaultFormatError extends Error {
  constructor(message = 'value is not a vault envelope') {
    super(message);
    this.name = 'VaultFormatError';
  }
}

/** No provided key matches the envelope's key fingerprint. */
export class VaultKeyUnknownError extends Error {
  constructor(fingerprint: string) {
    super(`no encryption key matches fingerprint ${fingerprint}`);
    this.name = 'VaultKeyUnknownError';
  }
}

/** Authentication failed: the value was tampered with or rebound. */
export class VaultDecryptError extends Error {
  constructor() {
    super('envelope failed authentication (tampered, or bound to a different record)');
    this.name = 'VaultDecryptError';
  }
}

/** The row/field identity a secret is sealed to (the GCM AAD). */
export interface VaultScope {
  organizationId: string;
  credentialId: string;
  field: string;
}

function aadFor(scope: VaultScope): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `helio:cred:${VERSION}:${scope.organizationId}:${scope.credentialId}:${scope.field}`,
  );
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new VaultFormatError('envelope segment is not valid base64');
  }
}

function decodeKey(keyB64: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(keyB64.trim()), (char) => char.charCodeAt(0));
  } catch {
    throw new VaultFormatError('encryption key is not valid base64');
  }
  if (bytes.length !== KEY_BYTES) {
    throw new VaultFormatError(`encryption key must be ${KEY_BYTES} bytes (got ${bytes.length})`);
  }
  return bytes;
}

/** Mint a new deployment encryption key (base64 of 32 random bytes). */
export function generateEncryptionKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/** First 8 hex chars of SHA-256 over the raw key bytes. */
export async function keyFingerprint(keyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', decodeKey(keyB64));
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Cheap structural check — true for strings shaped like an envelope. */
export function isEnvelope(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(`${PREFIX}:${VERSION}:`) &&
    value.split(':').length === 6
  );
}

export interface ParsedEnvelope {
  fingerprint: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
  tag: Uint8Array<ArrayBuffer>;
}

/** Split an envelope into its parts; throws VaultFormatError on bad shape. */
export function parseEnvelope(envelope: string): ParsedEnvelope {
  const segments = envelope.split(':');
  if (segments.length !== 6 || segments[0] !== PREFIX || segments[1] !== VERSION) {
    throw new VaultFormatError();
  }
  const [, , fingerprint, ivB64, ctB64, tagB64] = segments as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!/^[0-9a-f]{8}$/.test(fingerprint)) {
    throw new VaultFormatError('envelope key fingerprint is malformed');
  }
  const iv = fromBase64(ivB64);
  const tag = fromBase64(tagB64);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new VaultFormatError('envelope iv/tag length is wrong');
  }
  return { fingerprint, iv, ciphertext: fromBase64(ctB64), tag };
}

async function importAesKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', decodeKey(keyB64), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Seal one field value for one credential row. */
export async function encryptField(
  plaintext: string,
  scope: VaultScope,
  keyB64: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aadFor(scope) },
      await importAesKey(keyB64),
      new TextEncoder().encode(plaintext),
    ),
  );
  // Web Crypto returns ciphertext with the 16-byte tag appended.
  const ciphertext = sealed.slice(0, sealed.length - TAG_BYTES);
  const tag = sealed.slice(sealed.length - TAG_BYTES);
  const fingerprint = await keyFingerprint(keyB64);
  return [PREFIX, VERSION, fingerprint, toBase64(iv), toBase64(ciphertext), toBase64(tag)].join(
    ':',
  );
}

/**
 * Open an envelope. The active key is tried by fingerprint; during a
 * rotation the previous key stays accepted until the re-encrypt walk
 * finishes. Neither error ever carries plaintext or key material.
 */
export async function decryptField(
  envelope: string,
  scope: VaultScope,
  keyB64: string,
  previousKeyB64?: string,
): Promise<string> {
  const parsed = parseEnvelope(envelope);
  let candidate: string | null = null;
  if ((await keyFingerprint(keyB64)) === parsed.fingerprint) {
    candidate = keyB64;
  } else if (previousKeyB64 && (await keyFingerprint(previousKeyB64)) === parsed.fingerprint) {
    candidate = previousKeyB64;
  }
  if (!candidate) throw new VaultKeyUnknownError(parsed.fingerprint);

  const sealed = new Uint8Array(parsed.ciphertext.length + parsed.tag.length);
  sealed.set(parsed.ciphertext, 0);
  sealed.set(parsed.tag, parsed.ciphertext.length);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: parsed.iv,
        additionalData: aadFor(scope),
      },
      await importAesKey(candidate),
      sealed,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new VaultDecryptError();
  }
}
