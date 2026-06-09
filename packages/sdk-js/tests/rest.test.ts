import { describe, expect, it, vi } from 'vitest';

import { HelioApiClient, HelioApiError } from '../src/rest';

const API_KEY = 'hk_org_123.secret';
const BASE = 'https://api.test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A client whose fetch is a vi.fn returning the queued responses. */
function makeClient(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const client = new HelioApiClient({
    apiKey: API_KEY,
    baseUrl: `${BASE}/`, // trailing slash to verify it is stripped
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1)!;
  const url = call[0] as URL;
  const init = call[1] as RequestInit;
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body ? (JSON.parse(init.body as string) as unknown) : undefined,
  };
}

describe('HelioApiClient', () => {
  it('requires an apiKey and baseUrl', () => {
    expect(() => new HelioApiClient({ apiKey: '', baseUrl: BASE })).toThrow(/apiKey/);
    expect(() => new HelioApiClient({ apiKey: API_KEY, baseUrl: '' })).toThrow(/baseUrl/);
  });

  it('creates a workspace with auth, content-type, and idempotency headers', async () => {
    const { client, fetchMock } = makeClient(json({ id: 'ws_1', slug: 'prod' }, 201));
    const workspace = await client.workspaces.create(
      { name: 'Prod', slug: 'prod' },
      { idempotencyKey: 'idem-1' },
    );
    expect(workspace.id).toBe('ws_1');
    const call = lastCall(fetchMock);
    expect(call.method).toBe('POST');
    expect(call.url.toString()).toBe(`${BASE}/v1/workspaces`); // no double slash
    expect(call.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers['idempotency-key']).toBe('idem-1');
    expect(call.body).toEqual({ name: 'Prod', slug: 'prod' });
  });

  it('lists workspaces', async () => {
    const { client, fetchMock } = makeClient(json([{ id: 'ws_1' }]));
    const result = await client.workspaces.list();
    expect(result).toHaveLength(1);
    expect(lastCall(fetchMock).method).toBe('GET');
  });

  it('lists contacts with query params, omitting undefined', async () => {
    const { client, fetchMock } = makeClient(json({ data: [], nextCursor: null }));
    await client.contacts.list({ workspaceId: 'ws_1', limit: 25 });
    const { url, headers } = lastCall(fetchMock);
    expect(url.pathname).toBe('/v1/contacts');
    expect(url.searchParams.get('workspaceId')).toBe('ws_1');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.has('search')).toBe(false);
    // GET requests carry no content-type.
    expect(headers['content-type']).toBeUndefined();
  });

  it('creates, retrieves, updates, and deletes a contact', async () => {
    const { client, fetchMock } = makeClient(
      json({ id: 'contact_1', email: 'a@b.com' }, 201),
      json({ id: 'contact_1', email: 'a@b.com' }),
      json({ id: 'contact_1', firstName: 'Jane' }),
      new Response(null, { status: 204 }),
    );

    await client.contacts.create({ workspaceId: 'ws_1', email: 'a@b.com' });
    expect(lastCall(fetchMock).method).toBe('POST');

    await client.contacts.get('contact_1');
    expect(lastCall(fetchMock).url.pathname).toBe('/v1/contacts/contact_1');

    await client.contacts.update('contact_1', { firstName: 'Jane' });
    const patch = lastCall(fetchMock);
    expect(patch.method).toBe('PATCH');
    expect(patch.body).toEqual({ firstName: 'Jane' });

    const deleted = await client.contacts.delete('contact_1');
    expect(deleted).toBeUndefined();
    expect(lastCall(fetchMock).method).toBe('DELETE');
  });

  it('encodes path ids', async () => {
    const { client, fetchMock } = makeClient(json({ id: 'x' }));
    await client.contacts.get('a/b c');
    expect(lastCall(fetchMock).url.pathname).toBe('/v1/contacts/a%2Fb%20c');
  });

  it('manages list members', async () => {
    const { client, fetchMock } = makeClient(
      json({ added: 2 }),
      new Response(null, { status: 204 }),
    );
    const added = await client.lists.addMembers('list_1', ['c1', 'c2']);
    expect(added).toEqual({ added: 2 });
    expect(lastCall(fetchMock).body).toEqual({ contactIds: ['c1', 'c2'] });

    await client.lists.removeMember('list_1', 'c1');
    expect(lastCall(fetchMock).url.pathname).toBe('/v1/lists/list_1/members/c1');
    expect(lastCall(fetchMock).method).toBe('DELETE');
  });

  it('paginates lists', async () => {
    const { client, fetchMock } = makeClient(
      json({ data: [{ id: 'list_1' }], nextCursor: 'list_1' }),
    );
    const page = await client.lists.list({ workspaceId: 'ws_1' });
    expect(page.nextCursor).toBe('list_1');
    expect(lastCall(fetchMock).url.searchParams.get('workspaceId')).toBe('ws_1');
  });

  it('creates, retrieves, and deletes a list', async () => {
    const { client, fetchMock } = makeClient(
      json({ id: 'list_1', name: 'VIP' }, 201),
      json({ id: 'list_1', name: 'VIP', memberCount: 3 }),
      new Response(null, { status: 204 }),
    );
    const created = await client.lists.create({ workspaceId: 'ws_1', name: 'VIP' });
    expect(created.id).toBe('list_1');
    expect(lastCall(fetchMock).method).toBe('POST');

    await client.lists.get('list_1');
    expect(lastCall(fetchMock).url.pathname).toBe('/v1/lists/list_1');

    const deleted = await client.lists.delete('list_1');
    expect(deleted).toBeUndefined();
    expect(lastCall(fetchMock).method).toBe('DELETE');
  });

  it('throws a HelioApiError carrying the problem document', async () => {
    const { client } = makeClient(
      json(
        {
          type: 'urn:helio:problem:http_409',
          title: 'conflict',
          status: 409,
          detail: 'a contact with this email already exists',
        },
        409,
      ),
    );
    await expect(
      client.contacts.create({ workspaceId: 'ws_1', email: 'a@b.com' }),
    ).rejects.toMatchObject({
      name: 'HelioApiError',
      status: 409,
      type: 'urn:helio:problem:http_409',
      detail: 'a contact with this email already exists',
    });
  });

  it('synthesizes a problem when the error body is not JSON', async () => {
    const { client } = makeClient(new Response('gateway down', { status: 502 }));
    const error = await client.workspaces.list().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HelioApiError);
    expect((error as HelioApiError).status).toBe(502);
  });
});
