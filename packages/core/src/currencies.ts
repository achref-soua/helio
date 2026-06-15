/**
 * The currencies an organization can choose for deal amounts and revenue
 * across the dashboard. A curated set (the common ones) keeps the picker
 * short; `Intl.NumberFormat` does the actual locale-aware formatting, so any
 * ISO 4217 code would render — this list just bounds the choice.
 */
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'US Dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'British Pound' },
  { code: 'JPY', label: 'Japanese Yen' },
  { code: 'CAD', label: 'Canadian Dollar' },
  { code: 'AUD', label: 'Australian Dollar' },
  { code: 'CHF', label: 'Swiss Franc' },
  { code: 'CNY', label: 'Chinese Yuan' },
  { code: 'INR', label: 'Indian Rupee' },
  { code: 'BRL', label: 'Brazilian Real' },
  { code: 'AED', label: 'UAE Dirham' },
  { code: 'SAR', label: 'Saudi Riyal' },
  { code: 'SEK', label: 'Swedish Krona' },
  { code: 'NOK', label: 'Norwegian Krone' },
  { code: 'DKK', label: 'Danish Krone' },
  { code: 'PLN', label: 'Polish Złoty' },
  { code: 'SGD', label: 'Singapore Dollar' },
  { code: 'HKD', label: 'Hong Kong Dollar' },
  { code: 'NZD', label: 'New Zealand Dollar' },
  { code: 'ZAR', label: 'South African Rand' },
  { code: 'MXN', label: 'Mexican Peso' },
  { code: 'TRY', label: 'Turkish Lira' },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

/** True when `code` is one of the offered currencies (case-sensitive, upper). */
export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.some((entry) => entry.code === code);
}

/**
 * Format an amount in minor units (e.g. cents) in `currency`, locale-aware.
 * Falls back to a plain "12.34 XXX" if the runtime doesn't know the code.
 */
export function formatMoney(minorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      minorUnits / 100,
    );
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}
