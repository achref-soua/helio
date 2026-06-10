import { describe, expect, it } from 'vitest';

import { CONTACT_CSV_HEADER, contactsToCsv, csvCell, csvDocument } from '../src/csv';

describe('csvCell', () => {
  it('passes plain values through and blanks null/undefined', () => {
    expect(csvCell('ada@example.com')).toBe('ada@example.com');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes separators, quotes, and newlines per RFC 4180', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('defuses spreadsheet formula injection', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+1234')).toBe('"\'+1234"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
  });

  it('serializes dates as ISO strings and objects as JSON', () => {
    expect(csvCell(new Date('2026-06-10T12:00:00Z'))).toBe('2026-06-10T12:00:00.000Z');
    expect(csvCell({ plan: 'pro' })).toBe('"{""plan"":""pro""}"');
  });
});

describe('csvDocument', () => {
  it('joins header and rows with CRLF and a trailing newline', () => {
    expect(csvDocument(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2\r\n');
  });
});

describe('contactsToCsv', () => {
  it('round-trips a contact and omits empty attribute bags', () => {
    const csv = contactsToCsv([
      {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: null,
        phone: null,
        status: 'ACTIVE',
        score: 7,
        source: 'import',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        attributes: {},
      },
    ]);
    const [header, row] = csv.trimEnd().split('\r\n');
    expect(header).toBe(CONTACT_CSV_HEADER.join(','));
    expect(row).toBe('ada@example.com,Ada,,,ACTIVE,7,import,2026-06-01T00:00:00.000Z,');
  });

  it('keeps attribute JSON when present', () => {
    const csv = contactsToCsv([
      {
        email: 'a@x.com',
        firstName: null,
        lastName: null,
        phone: null,
        status: 'ACTIVE',
        score: 0,
        source: null,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        attributes: { plan: 'pro' },
      },
    ]);
    expect(csv).toContain('"{""plan"":""pro""}"');
  });
});
