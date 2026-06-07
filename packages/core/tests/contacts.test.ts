import { describe, expect, it } from 'vitest';

import { contactEmailSchema, normalizeContactRows } from '../src/contacts';

describe('contactEmailSchema', () => {
  it('trims, lowercases, and validates', () => {
    expect(contactEmailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(contactEmailSchema.safeParse('not-an-email').success).toBe(false);
    expect(contactEmailSchema.safeParse('').success).toBe(false);
  });
});

describe('normalizeContactRows', () => {
  it('matches tolerant header aliases', () => {
    const { valid } = normalizeContactRows([
      { 'E-Mail': 'a@x.com', 'First Name': 'Ada', surname: 'Lovelace' },
      { 'email address': 'b@x.com', GivenName: 'Grace' },
    ]);
    expect(valid).toEqual([
      { email: 'a@x.com', firstName: 'Ada', lastName: 'Lovelace', attributes: {} },
      { email: 'b@x.com', firstName: 'Grace', attributes: {} },
    ]);
  });

  it('keeps unknown columns as string attributes and drops empties', () => {
    const { valid } = normalizeContactRows([
      { email: 'a@x.com', company: 'Acme', plan: 'pro', empty: '   ' },
    ]);
    expect(valid[0]!.attributes).toEqual({ company: 'Acme', plan: 'pro' });
  });

  it('counts invalid emails and in-batch duplicates', () => {
    const result = normalizeContactRows([
      { email: 'a@x.com' },
      { email: 'A@X.com' }, // duplicate after normalization
      { email: 'broken' },
      { name: 'no email at all' },
    ]);
    expect(result.valid).toHaveLength(1);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(2);
  });
});
