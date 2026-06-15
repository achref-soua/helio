import { describe, expect, it } from 'vitest';

import { formatMoney, isSupportedCurrency, SUPPORTED_CURRENCIES } from './currencies';

describe('isSupportedCurrency', () => {
  it('accepts supported upper-case codes', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('EUR')).toBe(true);
    expect(isSupportedCurrency('JPY')).toBe(true);
  });

  it('rejects unknown, empty, or wrong-case codes', () => {
    expect(isSupportedCurrency('usd')).toBe(false);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(isSupportedCurrency('')).toBe(false);
  });
});

describe('SUPPORTED_CURRENCIES', () => {
  it('are unique, well-formed ISO-4217 codes with a label', () => {
    const codes = SUPPORTED_CURRENCIES.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const entry of SUPPORTED_CURRENCIES) {
      expect(entry.code).toMatch(/^[A-Z]{3}$/);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

describe('formatMoney', () => {
  it('renders minor units as a localized currency amount', () => {
    // 123456 minor units = 1,234.56 major units. The "." in the pattern is a
    // wildcard so it holds whether the locale uses "," or "." as a separator.
    expect(formatMoney(123456, 'USD')).toMatch(/1.234.56/);
    expect(formatMoney(0, 'EUR')).toMatch(/0/);
  });

  it('falls back to a plain "amount code" string for malformed codes', () => {
    // Intl rejects a non-3-letter currency code; the catch path takes over.
    expect(formatMoney(100, 'US')).toBe('1.00 US');
    expect(formatMoney(2599, 'DOLLARS')).toBe('25.99 DOLLARS');
  });
});
