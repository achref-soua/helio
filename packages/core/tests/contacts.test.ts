import { describe, expect, it } from 'vitest';

import {
  contactEmailSchema,
  detectImportSource,
  normalizeContactRows,
  normalizeMappedRows,
  suggestColumnMapping,
} from '../src/contacts';

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

describe('migration importers', () => {
  it('detects the vendor from signature columns', () => {
    expect(detectImportSource(['Email', 'Member Rating', 'OPTIN TIME'])).toBe('mailchimp');
    expect(detectImportSource(['Email', 'Klaviyo ID'])).toBe('klaviyo');
    expect(detectImportSource(['Email', 'Record ID', 'Lifecycle Stage'])).toBe('hubspot');
    expect(detectImportSource(['email', 'company'])).toBe('csv');
    expect(detectImportSource([])).toBe('csv');
  });

  it('maps a Mailchimp export, suppressing the unsubscribed', () => {
    const result = normalizeContactRows([
      {
        'Email Address': 'a@x.com',
        'First Name': 'Ada',
        'Member Rating': '5',
        STATUS: 'subscribed',
      },
      { 'Email Address': 'b@x.com', 'Member Rating': '2', STATUS: 'unsubscribed' },
      { 'Email Address': 'c@x.com', 'Member Rating': '1', STATUS: 'cleaned' },
    ]);
    expect(result.source).toBe('mailchimp');
    expect(result.suppressed).toBe(2);
    expect(result.valid.find((r) => r.email === 'a@x.com')!.status).toBe('ACTIVE');
    expect(result.valid.find((r) => r.email === 'b@x.com')!.status).toBe('UNSUBSCRIBED');
    expect(result.valid.find((r) => r.email === 'c@x.com')!.status).toBe('UNSUBSCRIBED');
    // The signature column is not leaked into attributes-as-status, but a
    // non-status column like Member Rating still becomes an attribute.
    expect(result.valid[0]!.attributes['Member Rating']).toBe('5');
  });

  it('reads HubSpot "Unsubscribed from All Email" as a negative-polarity flag', () => {
    const result = normalizeContactRows([
      { Email: 'a@x.com', 'Record ID': '1', 'Unsubscribed from All Email': 'true' },
      { Email: 'b@x.com', 'Record ID': '2', 'Unsubscribed from All Email': 'false' },
    ]);
    expect(result.source).toBe('hubspot');
    expect(result.valid[0]!.status).toBe('UNSUBSCRIBED');
    expect(result.valid[1]!.status).toBe('ACTIVE');
  });

  it('reads Klaviyo consent (false = unsubscribed)', () => {
    const result = normalizeContactRows([
      { Email: 'a@x.com', 'Klaviyo ID': 'k1', 'Email Marketing Consent': 'true' },
      { Email: 'b@x.com', 'Klaviyo ID': 'k2', 'Email Marketing Consent': 'false' },
    ]);
    expect(result.source).toBe('klaviyo');
    expect(result.valid[0]!.status).toBe('ACTIVE');
    expect(result.valid[1]!.status).toBe('UNSUBSCRIBED');
    expect(result.suppressed).toBe(1);
  });
});

describe('mapped imports (the wizard)', () => {
  it('suggests a mapping from tolerant headers', () => {
    const mapping = suggestColumnMapping([
      'Email Address',
      'First Name',
      'Company',
      'Subscription Status',
      'Nickname',
    ]);
    expect(mapping).toEqual({
      'Email Address': 'email',
      'First Name': 'firstName',
      Company: 'company',
      'Subscription Status': 'status',
      Nickname: 'attribute',
    });
  });

  it('normalizes under an explicit mapping with companies and errors', () => {
    const result = normalizeMappedRows(
      [
        { Mail: 'a@x.com', Co: 'Acme', Nick: 'Ace', Hidden: 'drop me' },
        { Mail: 'not-an-email', Co: 'Acme' },
        { Mail: 'a@x.com', Co: 'Other' },
        { Mail: 'b@x.com', Sub: 'unsubscribed' },
      ],
      { Mail: 'email', Co: 'company', Nick: 'attribute', Hidden: 'skip', Sub: 'status' },
    );
    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]).toMatchObject({
      email: 'a@x.com',
      company: 'Acme',
      attributes: { Nick: 'Ace' },
    });
    expect(result.valid[0]!.attributes.Hidden).toBeUndefined();
    expect(result.companies).toEqual(['Acme']);
    expect(result.invalid).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.errors).toEqual([
      { row: 2, reason: 'invalid email: not-an-email' },
      { row: 3, reason: 'duplicate of a@x.com earlier in the file' },
    ]);
  });
});
