/**
 * CSV export helpers (RFC 4180: CRLF rows, quote-doubling) with spreadsheet
 * formula-injection hardening — a contact attribute like `=HYPERLINK(...)`
 * must never execute when an operator opens the export in Excel/Sheets.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_PREFIX = /^[=+\-@\t]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (NEEDS_QUOTING.test(text) || text.startsWith("'")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function csvDocument(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export interface ContactCsvRow {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: string;
  score: number;
  source: string | null;
  createdAt: Date;
  attributes: unknown;
}

export const CONTACT_CSV_HEADER = [
  'email',
  'first_name',
  'last_name',
  'phone',
  'status',
  'score',
  'source',
  'created_at',
  'attributes',
];

/** The operator-facing contact export, importable back into Helio. */
export function contactsToCsv(contacts: ContactCsvRow[]): string {
  return csvDocument(
    CONTACT_CSV_HEADER,
    contacts.map((contact) => [
      contact.email,
      contact.firstName,
      contact.lastName,
      contact.phone,
      contact.status,
      contact.score,
      contact.source,
      contact.createdAt,
      contact.attributes && Object.keys(contact.attributes as object).length > 0
        ? contact.attributes
        : null,
    ]),
  );
}
