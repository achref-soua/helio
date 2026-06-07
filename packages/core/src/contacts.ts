import { z } from 'zod';

/** Lowercased, trimmed, validated email. */
export const contactEmailSchema = z.string().trim().toLowerCase().pipe(z.string().email());

export interface NormalizedContactRow {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Any extra CSV columns, kept as string attributes. */
  attributes: Record<string, string>;
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

export interface NormalizeResult {
  valid: NormalizedContactRow[];
  /** Rows dropped for a missing/invalid email. */
  invalid: number;
  /** Rows dropped as in-batch duplicates (same email). */
  duplicates: number;
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

  for (const raw of rows) {
    const row: NormalizedContactRow = { email: '', attributes: {} };
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      const value = String(rawValue ?? '').trim();
      if (value === '') continue;
      const key = rawKey.trim().toLowerCase();
      const known = HEADER_ALIASES[key];
      if (known === 'email') row.email = value;
      else if (known === 'firstName') row.firstName = value;
      else if (known === 'lastName') row.lastName = value;
      else row.attributes[rawKey.trim()] = value;
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
    valid.push(row);
  }

  return { valid, invalid, duplicates };
}
