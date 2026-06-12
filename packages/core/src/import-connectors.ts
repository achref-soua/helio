import type { ColumnMapping } from './contacts';

/**
 * API connectors for the import wizard (I2/I3): pull contacts straight
 * from HubSpot, Mailchimp, or Klaviyo with the vendor token from the
 * credential vault, shape them into plain rows, and feed the exact same
 * mapped-import pipeline the CSV path uses. Pure and fetch-injected —
 * every connector is unit-tested against fixture payloads.
 */

export type ImportConnector = 'hubspot' | 'mailchimp' | 'klaviyo';

/** The fixed mapping connector rows ride through `normalizeMappedRows`. */
export const CONNECTOR_MAPPING: ColumnMapping = {
  email: 'email',
  'first name': 'firstName',
  'last name': 'lastName',
  company: 'company',
  status: 'status',
};

export class ConnectorError extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_ROWS = 10_000;
const MAX_PAGES = 200;

function authFailure(vendor: string): ConnectorError {
  return new ConnectorError(
    `${vendor} rejected the token — re-check the credential under Settings → Provider credentials`,
  );
}

/** HubSpot private-app token → contact rows (with company + opt-out). */
export async function fetchHubSpotRows(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<Array<Record<string, string>>> {
  const rows: Array<Record<string, string>> = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES && rows.length < MAX_ROWS; page += 1) {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/contacts');
    url.searchParams.set('limit', '100');
    url.searchParams.set('properties', 'email,firstname,lastname,company,hs_email_optout');
    if (after) url.searchParams.set('after', after);
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401 || response.status === 403) throw authFailure('HubSpot');
    if (!response.ok) throw new ConnectorError(`HubSpot answered HTTP ${response.status}`);
    const body = (await response.json()) as {
      results?: Array<{ properties?: Record<string, string | null> }>;
      paging?: { next?: { after?: string } };
    };
    for (const result of body.results ?? []) {
      const properties = result.properties ?? {};
      if (!properties.email) continue;
      rows.push({
        email: properties.email,
        'first name': properties.firstname ?? '',
        'last name': properties.lastname ?? '',
        company: properties.company ?? '',
        status: properties.hs_email_optout === 'true' ? 'unsubscribed' : 'subscribed',
      });
    }
    after = body.paging?.next?.after;
    if (!after) break;
  }
  return rows.slice(0, MAX_ROWS);
}

/** Mailchimp API key (`…-us21` carries the datacenter) → all audiences. */
export async function fetchMailchimpRows(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<Array<Record<string, string>>> {
  const dc = apiKey.split('-').pop();
  if (!dc || !/^[a-z]+\d+$/.test(dc)) {
    throw new ConnectorError(
      'that does not look like a Mailchimp API key (it ends in a datacenter, e.g. -us21)',
    );
  }
  const base = `https://${dc}.api.mailchimp.com/3.0`;
  const headers = { authorization: `Bearer ${apiKey}` };

  const listsResponse = await fetchImpl(`${base}/lists?count=60`, { headers });
  if (listsResponse.status === 401) throw authFailure('Mailchimp');
  if (!listsResponse.ok) {
    throw new ConnectorError(`Mailchimp answered HTTP ${listsResponse.status}`);
  }
  const lists = (await listsResponse.json()) as { lists?: Array<{ id: string }> };

  const rows: Array<Record<string, string>> = [];
  for (const list of lists.lists ?? []) {
    for (let offset = 0; rows.length < MAX_ROWS; offset += 1000) {
      const response = await fetchImpl(
        `${base}/lists/${list.id}/members?count=1000&offset=${offset}`,
        { headers },
      );
      if (!response.ok) throw new ConnectorError(`Mailchimp answered HTTP ${response.status}`);
      const body = (await response.json()) as {
        members?: Array<{
          email_address?: string;
          status?: string;
          merge_fields?: { FNAME?: string; LNAME?: string };
        }>;
      };
      const members = body.members ?? [];
      for (const member of members) {
        if (!member.email_address) continue;
        rows.push({
          email: member.email_address,
          'first name': member.merge_fields?.FNAME ?? '',
          'last name': member.merge_fields?.LNAME ?? '',
          company: '',
          // subscribed|unsubscribed|cleaned|pending — the normalizer's
          // status vocabulary already understands these.
          status: member.status ?? 'subscribed',
        });
      }
      if (members.length < 1000) break;
    }
  }
  return rows.slice(0, MAX_ROWS);
}

/** Klaviyo private key → profiles, with marketing consent honored. */
export async function fetchKlaviyoRows(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<Array<Record<string, string>>> {
  const rows: Array<Record<string, string>> = [];
  let url: string | null =
    'https://a.klaviyo.com/api/profiles/?page[size]=100&additional-fields[profile]=subscriptions';
  for (let page = 0; page < MAX_PAGES && url && rows.length < MAX_ROWS; page += 1) {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: '2024-10-15',
        accept: 'application/json',
      },
    });
    if (response.status === 401 || response.status === 403) throw authFailure('Klaviyo');
    if (!response.ok) throw new ConnectorError(`Klaviyo answered HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: Array<{
        attributes?: {
          email?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          organization?: string | null;
          subscriptions?: { email?: { marketing?: { consent?: string } } };
        };
      }>;
      links?: { next?: string | null };
    };
    for (const profile of body.data ?? []) {
      const attributes = profile.attributes ?? {};
      if (!attributes.email) continue;
      const consent = attributes.subscriptions?.email?.marketing?.consent ?? '';
      rows.push({
        email: attributes.email,
        'first name': attributes.first_name ?? '',
        'last name': attributes.last_name ?? '',
        company: attributes.organization ?? '',
        status: consent.toUpperCase() === 'UNSUBSCRIBED' ? 'unsubscribed' : 'subscribed',
      });
    }
    url = body.links?.next ?? null;
  }
  return rows.slice(0, MAX_ROWS);
}
