import { z } from 'zod';

/** Lowercased, trimmed, validated email. */
export const contactEmailSchema = z.string().trim().toLowerCase().pipe(z.string().email());

export type ImportStatus = 'ACTIVE' | 'UNSUBSCRIBED';

export interface NormalizedContactRow {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Subscription status mapped from a vendor's status/consent column. */
  status?: ImportStatus;
  /** Any extra CSV columns, kept as string attributes. */
  attributes: Record<string, string>;
  /** Company name (mapped imports) — matched or created server-side. */
  company?: string;
}

const HEADER_ALIASES: Record<string, 'email' | 'firstName' | 'lastName'> = {
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  'email address': 'email',
  firstname: 'firstName',
  'first name': 'firstName',
  first_name: 'firstName',
  givenname: 'firstName',
  'given name': 'firstName',
  lastname: 'lastName',
  'last name': 'lastName',
  last_name: 'lastName',
  surname: 'lastName',
  'family name': 'lastName',
};

// Columns whose *value* describes a subscription/consent status. The
// covers HubSpot, Mailchimp, and Klaviyo contact exports.
const STATUS_HEADERS = new Set([
  'status',
  'subscription status',
  'subscriber status',
  'marketing status',
  'email marketing consent',
  'email permission status',
  'consent',
  'opt-in',
  'optin',
  'opt in',
]);
// Columns phrased as "is this contact unsubscribed?" — truthy ⇒ UNSUBSCRIBED.
const NEGATIVE_HEADERS = new Set([
  'unsubscribed',
  'unsubscribed from all email',
  'do not email',
  'email opt out',
  'opted out',
  'suppressed',
]);
const UNSUBSCRIBED_VALUES = new Set([
  'unsubscribed',
  'unsub',
  'cleaned',
  'suppressed',
  'bounced',
  'opted out',
  'opt out',
  'opt-out',
  'false',
  'no',
  'never',
  '0',
]);
const TRUTHY = new Set(['true', 'yes', '1', 'y']);

/** The vendor a CSV most likely came from, for a friendlier import UX. */
export type ImportSource = 'hubspot' | 'mailchimp' | 'klaviyo' | 'csv';

export function detectImportSource(headers: string[]): ImportSource {
  const set = new Set(headers.map((header) => header.trim().toLowerCase()));
  if (set.has('email marketing consent') || set.has('klaviyo id')) return 'klaviyo';
  if (set.has('member rating') || set.has('confirm time') || set.has('optin time')) {
    return 'mailchimp';
  }
  if (set.has('contact id') || set.has('lifecycle stage') || set.has('record id')) return 'hubspot';
  return 'csv';
}

function statusFor(headerLower: string, value: string): ImportStatus | undefined {
  const lowered = value.trim().toLowerCase();
  if (NEGATIVE_HEADERS.has(headerLower)) {
    return TRUTHY.has(lowered) ? 'UNSUBSCRIBED' : 'ACTIVE';
  }
  if (STATUS_HEADERS.has(headerLower)) {
    return UNSUBSCRIBED_VALUES.has(lowered) ? 'UNSUBSCRIBED' : 'ACTIVE';
  }
  return undefined;
}

export interface NormalizeResult {
  valid: NormalizedContactRow[];
  /** Rows dropped for a missing/invalid email. */
  invalid: number;
  /** Rows dropped as in-batch duplicates (same email). */
  duplicates: number;
  /** The detected vendor of the file. */
  source: ImportSource;
  /** Imported rows mapped to UNSUBSCRIBED (suppressed, not mailed). */
  suppressed: number;
}

/**
 * Normalize parsed CSV rows (header → value objects) into contact rows:
 * tolerant header matching, email validation, in-batch dedupe, and
 * unknown columns preserved as string attributes.
 */
export function normalizeContactRows(rows: Array<Record<string, unknown>>): NormalizeResult {
  const seen = new Set<string>();
  const valid: NormalizedContactRow[] = [];
  let invalid = 0;
  let duplicates = 0;
  let suppressed = 0;
  const source = detectImportSource(rows[0] ? Object.keys(rows[0]) : []);

  for (const raw of rows) {
    const row: NormalizedContactRow = { email: '', attributes: {} };
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      const value = String(rawValue ?? '').trim();
      if (value === '') continue;
      const key = rawKey.trim().toLowerCase();
      const known = HEADER_ALIASES[key];
      const mappedStatus = statusFor(key, value);
      if (known === 'email') row.email = value;
      else if (known === 'firstName') row.firstName = value;
      else if (known === 'lastName') row.lastName = value;
      else if (mappedStatus) {
        // A status/consent column drives status, not attributes. An
        // UNSUBSCRIBED reading wins even if another column read ACTIVE.
        if (mappedStatus === 'UNSUBSCRIBED' || row.status === undefined) row.status = mappedStatus;
      } else row.attributes[rawKey.trim()] = value;
    }

    const parsed = contactEmailSchema.safeParse(row.email);
    if (!parsed.success) {
      invalid += 1;
      continue;
    }
    row.email = parsed.data;
    if (seen.has(row.email)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.email);
    if (row.status === 'UNSUBSCRIBED') suppressed += 1;
    valid.push(row);
  }

  return { valid, invalid, duplicates, source, suppressed };
}

// ── Column-mapped imports (the wizard, I1) ─────────────────────────────────

/** Where a CSV column's values land. */
export const MAPPING_TARGETS = [
  'email',
  'firstName',
  'lastName',
  'status',
  'company',
  'attribute',
  'skip',
] as const;
export type MappingTarget = (typeof MAPPING_TARGETS)[number];
export type ColumnMapping = Record<string, MappingTarget>;

const COMPANY_HEADERS = new Set([
  'company',
  'company name',
  'organization',
  'organisation',
  'associated company',
  'account name',
]);

/**
 * Pre-fill the wizard's mapping from the same tolerant header knowledge
 * the auto importer uses; the operator can override every column.
 */
export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  let emailTaken = false;
  for (const header of headers) {
    const key = header.trim().toLowerCase();
    const known = HEADER_ALIASES[key];
    if (known === 'email' && !emailTaken) {
      mapping[header] = 'email';
      emailTaken = true;
    } else if (known === 'firstName' || known === 'lastName') {
      mapping[header] = known;
    } else if (STATUS_HEADERS.has(key) || NEGATIVE_HEADERS.has(key)) {
      mapping[header] = 'status';
    } else if (COMPANY_HEADERS.has(key)) {
      mapping[header] = 'company';
    } else {
      mapping[header] = 'attribute';
    }
  }
  return mapping;
}

export interface MappedNormalizeResult extends NormalizeResult {
  /** Distinct company names seen (create-or-match server-side). */
  companies: string[];
  /** Row-level rejection reasons (1-based row numbers), capped. */
  errors: Array<{ row: number; reason: string }>;
}

const MAX_ERROR_ROWS = 100;

/**
 * Normalize rows under an explicit column mapping — the wizard's path.
 * Same guarantees as the automatic normalizer (email validation, in-batch
 * dedupe, suppressed-state honoring) plus company extraction and
 * row-numbered rejection reasons for the summary download.
 */
export function normalizeMappedRows(
  rows: Array<Record<string, unknown>>,
  mapping: ColumnMapping,
): MappedNormalizeResult {
  const seen = new Set<string>();
  const valid: NormalizedContactRow[] = [];
  const companies = new Set<string>();
  const errors: Array<{ row: number; reason: string }> = [];
  let invalid = 0;
  let duplicates = 0;
  let suppressed = 0;
  const source = detectImportSource(rows[0] ? Object.keys(rows[0]) : []);

  rows.forEach((raw, index) => {
    const row: NormalizedContactRow = { email: '', attributes: {} };
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      const value = String(rawValue ?? '').trim();
      if (value === '') continue;
      const target = mapping[rawKey] ?? 'attribute';
      const keyLower = rawKey.trim().toLowerCase();
      if (target === 'skip') continue;
      else if (target === 'email') row.email = value;
      else if (target === 'firstName') row.firstName = value;
      else if (target === 'lastName') row.lastName = value;
      else if (target === 'status') {
        const mappedStatus =
          statusFor(keyLower, value) ??
          (UNSUBSCRIBED_VALUES.has(value.toLowerCase()) ? 'UNSUBSCRIBED' : 'ACTIVE');
        if (mappedStatus === 'UNSUBSCRIBED' || row.status === undefined) row.status = mappedStatus;
      } else if (target === 'company') {
        row.company = value;
      } else row.attributes[rawKey.trim()] = value;
    }

    const parsed = contactEmailSchema.safeParse(row.email);
    if (!parsed.success) {
      invalid += 1;
      if (errors.length < MAX_ERROR_ROWS) {
        errors.push({
          row: index + 1,
          reason: row.email ? `invalid email: ${row.email}` : 'no email in the mapped column',
        });
      }
      return;
    }
    row.email = parsed.data;
    if (seen.has(row.email)) {
      duplicates += 1;
      if (errors.length < MAX_ERROR_ROWS) {
        errors.push({ row: index + 1, reason: `duplicate of ${row.email} earlier in the file` });
      }
      return;
    }
    seen.add(row.email);
    if (row.status === 'UNSUBSCRIBED') suppressed += 1;
    // Companies count only from rows that will actually import.
    if (row.company) companies.add(row.company);
    valid.push(row);
  });

  return { valid, invalid, duplicates, source, suppressed, companies: [...companies], errors };
}
