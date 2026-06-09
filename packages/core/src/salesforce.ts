/** The Salesforce REST API version Helio targets. */
export const SALESFORCE_API_VERSION = 'v60.0';

/** A Salesforce Lead — the minimal fields Helio writes. */
export interface SalesforceLead {
  FirstName?: string;
  LastName: string;
  Email: string;
  Company: string;
}

interface ContactLike {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** Arbitrary JSON traits; `company` is read when present. */
  attributes?: unknown;
}

/**
 * Map a Helio contact to a Salesforce Lead. Salesforce requires `LastName` and
 * `Company`, so fall back to the email and a default when those are unknown.
 */
export function salesforceLeadFromContact(
  contact: ContactLike,
  defaultCompany = 'Unknown',
): SalesforceLead {
  const attributes =
    contact.attributes &&
    typeof contact.attributes === 'object' &&
    !Array.isArray(contact.attributes)
      ? (contact.attributes as Record<string, unknown>)
      : {};
  const rawCompany = attributes.company;
  const company =
    typeof rawCompany === 'string' && rawCompany.trim() ? rawCompany.trim() : defaultCompany;
  return {
    FirstName: contact.firstName?.trim() || undefined,
    LastName: contact.lastName?.trim() || contact.email,
    Email: contact.email,
    Company: company,
  };
}

export interface SalesforceResult {
  id: string;
}

/**
 * Create a Lead through the Salesforce REST API. `fetchImpl` is injectable so
 * the call can be unit-tested without a live org; a non-2xx response throws.
 */
export async function pushSalesforceLead(
  fetchImpl: typeof fetch,
  instanceUrl: string,
  accessToken: string,
  lead: SalesforceLead,
): Promise<SalesforceResult> {
  const base = instanceUrl.replace(/\/$/, '');
  const url = `${base}/services/data/${SALESFORCE_API_VERSION}/sobjects/Lead`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(lead),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Salesforce Lead create failed: ${response.status}`);
  }
  const data = (await response.json()) as { id?: string };
  return { id: data.id ?? '' };
}
