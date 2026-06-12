import { describe, expect, it } from 'vitest';

import { normalizeMappedRows } from '../src/contacts';
import {
  CONNECTOR_MAPPING,
  ConnectorError,
  fetchHubSpotRows,
  fetchKlaviyoRows,
  fetchMailchimpRows,
} from '../src/import-connectors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HubSpot connector', () => {
  it('paginates, maps properties, and honors the opt-out flag', async () => {
    const calls: string[] = [];
    const rows = await fetchHubSpotRows('token', async (url) => {
      calls.push(url);
      if (!url.includes('after=')) {
        return jsonResponse({
          results: [
            {
              properties: {
                email: 'ada@x.com',
                firstname: 'Ada',
                lastname: 'Lovelace',
                company: 'Engines',
                hs_email_optout: 'false',
              },
            },
            { properties: { email: 'gone@x.com', hs_email_optout: 'true' } },
            { properties: { firstname: 'NoEmail' } },
          ],
          paging: { next: { after: 'cursor2' } },
        });
      }
      return jsonResponse({ results: [{ properties: { email: 'page2@x.com' } }] });
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('after=cursor2');
    expect(rows).toHaveLength(3);

    const normalized = normalizeMappedRows(rows, CONNECTOR_MAPPING);
    expect(normalized.valid).toHaveLength(3);
    expect(normalized.suppressed).toBe(1);
    expect(normalized.valid[0]).toMatchObject({
      email: 'ada@x.com',
      firstName: 'Ada',
      company: 'Engines',
    });
  });

  it('explains a rejected token', async () => {
    await expect(fetchHubSpotRows('bad', async () => jsonResponse({}, 401))).rejects.toThrow(
      /HubSpot rejected the token/,
    );
  });
});

describe('Mailchimp connector', () => {
  it('walks every audience and keeps vendor statuses', async () => {
    const rows = await fetchMailchimpRows('key-us21', async (url) => {
      if (url.endsWith('/lists?count=60')) {
        return jsonResponse({ lists: [{ id: 'l1' }] });
      }
      return jsonResponse({
        members: [
          {
            email_address: 'sub@x.com',
            status: 'subscribed',
            merge_fields: { FNAME: 'Sub', LNAME: 'Scribed' },
          },
          { email_address: 'clean@x.com', status: 'cleaned' },
        ],
      });
    });
    expect(rows).toHaveLength(2);
    const normalized = normalizeMappedRows(rows, CONNECTOR_MAPPING);
    expect(normalized.suppressed).toBe(1); // cleaned ⇒ suppressed
  });

  it('rejects keys without a datacenter suffix', async () => {
    await expect(fetchMailchimpRows('no-dc-here-', async () => jsonResponse({}))).rejects.toThrow(
      ConnectorError,
    );
  });
});

describe('Klaviyo connector', () => {
  it('follows next links and maps consent', async () => {
    const rows = await fetchKlaviyoRows('pk', async (url) => {
      if (!url.includes('page2')) {
        return jsonResponse({
          data: [
            {
              attributes: {
                email: 'k1@x.com',
                first_name: 'Kay',
                organization: 'Klav Co',
                subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
              },
            },
            {
              attributes: {
                email: 'k2@x.com',
                subscriptions: { email: { marketing: { consent: 'UNSUBSCRIBED' } } },
              },
            },
          ],
          links: { next: 'https://a.klaviyo.com/api/profiles/?page2' },
        });
      }
      return jsonResponse({ data: [], links: { next: null } });
    });
    expect(rows).toHaveLength(2);
    const normalized = normalizeMappedRows(rows, CONNECTOR_MAPPING);
    expect(normalized.suppressed).toBe(1);
    expect(normalized.valid[0]).toMatchObject({ email: 'k1@x.com', company: 'Klav Co' });
  });
});
