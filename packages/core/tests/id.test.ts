import { describe, expect, it } from 'vitest';

import { idTimestamp, isId, newId } from '../src/id';

const SUFFIX = /^[0-7][0123456789abcdefghjkmnpqrstvwxyz]{25}$/;

describe('newId', () => {
  it('produces prefix_suffix with a 26-char Crockford base32 suffix', () => {
    const id = newId('ws');
    expect(id.startsWith('ws_')).toBe(true);
    expect(id.slice(3)).toMatch(SUFFIX);
  });

  it('rejects invalid prefixes', () => {
    expect(() => newId('Org')).toThrowError(/Invalid ID prefix/);
    expect(() => newId('1abc')).toThrowError(/Invalid ID prefix/);
    expect(() => newId('a_')).toThrowError(/Invalid ID prefix/);
    expect(() => newId('a'.repeat(64))).toThrowError(/Invalid ID prefix/);
  });

  it('is collision-free across 10k generations', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId('contact')));
    expect(ids.size).toBe(10_000);
  });

  it('sorts lexicographically by creation time', () => {
    const earlier = newId('evt', 1_700_000_000_000);
    const later = newId('evt', 1_700_000_000_001);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('round-trips the embedded timestamp', () => {
    const at = 1_750_000_000_123;
    expect(idTimestamp(newId('org', at))).toBe(at);
  });
});

describe('isId', () => {
  it('accepts matching prefix and shape', () => {
    expect(isId(newId('user'), 'user')).toBe(true);
  });

  it('rejects wrong prefix, malformed suffix, and non-strings', () => {
    expect(isId(newId('user'), 'org')).toBe(false);
    expect(isId('user_short', 'user')).toBe(false);
    expect(isId('user_' + 'i'.repeat(26), 'user')).toBe(false); // 'i' not in alphabet
    expect(isId(42, 'user')).toBe(false);
  });
});

describe('idTimestamp', () => {
  it('throws on malformed suffixes', () => {
    expect(() => idTimestamp('org_invalid')).toThrowError(/Malformed ID suffix/);
  });
});
