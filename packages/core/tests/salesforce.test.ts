import { describe, expect, it, vi } from 'vitest';

import { pushSalesforceLead, salesforceLeadFromContact } from '../src/salesforce';

describe('salesforceLeadFromContact', () => {
  it('maps a contact, taking Company from attributes', () => {
    expect(
      salesforceLeadFromContact({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        attributes: { company: 'Analytical Engines' },
      }),
    ).toEqual({
      FirstName: 'Ada',
      LastName: 'Lovelace',
      Email: 'ada@example.com',
      Company: 'Analytical Engines',
    });
  });

  it('falls back to the email for LastName and a default Company', () => {
    expect(salesforceLeadFromContact({ email: 'nobody@example.com' })).toEqual({
      FirstName: undefined,
      LastName: 'nobody@example.com',
      Email: 'nobody@example.com',
      Company: 'Unknown',
    });
  });
});

describe('pushSalesforceLead', () => {
  const lead = { LastName: 'Lovelace', Email: 'ada@example.com', Company: 'Acme' };

  it('POSTs to the Leads endpoint with a bearer token and returns the id', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: '00Q1' }), { status: 201 }),
    ) as unknown as typeof fetch;
    const result = await pushSalesforceLead(
      fetchImpl,
      'https://acme.my.salesforce.com/',
      'tok',
      lead,
    );
    expect(result).toEqual({ id: '00Q1' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://acme.my.salesforce.com/services/data/v60.0/sobjects/Lead');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(
      pushSalesforceLead(fetchImpl, 'https://acme.my.salesforce.com', 'tok', lead),
    ).rejects.toThrow(/401/);
  });
});
