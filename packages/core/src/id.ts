/**
 * TypeID-style identifiers: a lowercase prefix, an underscore, and a
 * 26-character Crockford base32 encoding of a UUIDv7. The millisecond
 * timestamp occupies the most significant bits, so IDs sort
 * lexicographically in creation order — index-friendly and debuggable
 * (`ws_01jx3ye5k8f5rv9t6n0c2qmexample` is recognizably a workspace).
 */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const SUFFIX_LENGTH = 26;
const PREFIX_PATTERN = /^[a-z]([a-z_]{0,61}[a-z])?$/;
const SUFFIX_PATTERN = /^[0-7][0123456789abcdefghjkmnpqrstvwxyz]{25}$/;

export type Id<P extends string = string> = `${P}_${string}`;

function uuidv7Bytes(timestampMs: number): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ts = BigInt(timestampMs);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  return bytes;
}

function encodeSuffix(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    const shift = BigInt(5 * (SUFFIX_LENGTH - 1 - i));
    suffix += ALPHABET[Number((value >> shift) & 31n)];
  }
  return suffix;
}

/** Generate a new prefixed, time-ordered ID. */
export function newId<P extends string>(prefix: P, timestampMs: number = Date.now()): Id<P> {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `Invalid ID prefix "${prefix}": must be 1-63 lowercase letters or underscores, starting and ending with a letter`,
    );
  }
  return `${prefix}_${encodeSuffix(uuidv7Bytes(timestampMs))}`;
}

/** Check shape and prefix of an ID. */
export function isId<P extends string>(value: unknown, prefix: P): value is Id<P> {
  if (typeof value !== 'string') return false;
  if (!value.startsWith(`${prefix}_`)) return false;
  return SUFFIX_PATTERN.test(value.slice(prefix.length + 1));
}

/** Extract the embedded creation timestamp (ms since epoch). */
export function idTimestamp(id: Id): number {
  const suffix = id.slice(id.lastIndexOf('_') + 1);
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new Error(`Malformed ID suffix in "${id}"`);
  }
  let value = 0n;
  for (const char of suffix) {
    value = (value << 5n) | BigInt(ALPHABET.indexOf(char));
  }
  return Number(value >> 80n);
}
