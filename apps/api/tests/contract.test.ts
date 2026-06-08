import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { generateGatewayApiKey, newId } from '@helio/core';
import { createPrismaClient, type PrismaClient } from '@helio/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import RedisMock from 'ioredis-mock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import type { RedisLike } from '../src/types';

describe('gateway contract', () => {
  let container: StartedPostgreSqlContainer;
  let admin: PrismaClient;
  let app: ReturnType<typeof createApp>;
  const redis = new RedisMock() as unknown as RedisLike;
  const orgId = newId('org');
  const otherOrgId = newId('org');
  // A workspace in orgId to hold gateway-created contacts.
  let contactWsId: string;

  // API keys minted for each org; the bearer carries the org, so requests
  // never name it. Assigned in beforeAll once the orgs exist.
  let auth: Record<string, string>;
  let otherAuth: Record<string, string>;
  // A dedicated credential for the rate-limit test: ioredis-mock shares one
  // keyspace across instances, so a key used nowhere else gets its own bucket.
  let rateLimitAuth: Record<string, string>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_api_test')
      .start();
    const adminUrl = container.getConnectionUri();
    execSync('pnpm --filter @helio/db exec prisma migrate deploy', {
      cwd: path.resolve(import.meta.dirname, '../../..'),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
      stdio: 'pipe',
    });
    admin = createPrismaClient(adminUrl);
    await admin.organization.createMany({
      data: [
        { id: orgId, name: 'Contract Org', slug: 'contract-org' },
        { id: otherOrgId, name: 'Other Org', slug: 'other-org' },
      ],
    });
    contactWsId = newId('ws');
    await admin.workspace.create({
      data: { id: contactWsId, organizationId: orgId, name: 'Contacts WS', slug: 'contacts-ws' },
    });

    const orgKeyParts = await generateGatewayApiKey(orgId);
    const otherKeyParts = await generateGatewayApiKey(otherOrgId);
    const rateKeyParts = await generateGatewayApiKey(otherOrgId);
    await admin.gatewayApiKey.createMany({
      data: [orgKeyParts, otherKeyParts, rateKeyParts].map((parts, index) => ({
        id: newId('gwk'),
        organizationId: index === 0 ? orgId : otherOrgId,
        name: 'contract',
        keyHash: parts.keyHash,
        prefix: parts.prefix,
      })),
    });
    auth = { authorization: `Bearer ${orgKeyParts.key}` };
    otherAuth = { authorization: `Bearer ${otherKeyParts.key}` };
    rateLimitAuth = { authorization: `Bearer ${rateKeyParts.key}` };

    const appUrl = new URL(adminUrl);
    appUrl.username = 'helio_app';
    appUrl.password = 'helio_app';
    app = createApp({
      prisma: createPrismaClient(appUrl.toString()),
      redis,
      rateLimit: { max: 100, windowSeconds: 3600 },
    });
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await container?.stop();
  });

  it('healthz is public, readyz reports dependency state', async () => {
    expect((await app.request('/healthz')).status).toBe(200);
    const ready = await app.request('/readyz');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok' },
    });
  });

  it('rejects missing and unknown API keys with problem+json', async () => {
    const anonymous = await app.request('/v1/workspaces');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('content-type')).toBe('application/problem+json');

    // Well-formed (parses to an org) but never minted → no hash match → 401.
    const unknown = await app.request('/v1/workspaces', {
      headers: { authorization: `Bearer hk_${orgId}.this-secret-was-never-issued` },
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ status: 401, type: 'urn:helio:problem:http_401' });
  });

  it('creates and lists workspaces scoped to the key’s organization', async () => {
    const created = await app.request('/v1/workspaces', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Gateway WS', slug: 'gateway-ws' }),
    });
    expect(created.status).toBe(201);
    const workspace = (await created.json()) as { id: string; organizationId: string };
    expect(workspace.id.startsWith('ws_')).toBe(true);
    expect(workspace.organizationId).toBe(orgId);

    const list = await app.request('/v1/workspaces', { headers: auth });
    const items = (await list.json()) as Array<{ slug: string }>;
    expect(items.map((w) => w.slug)).toContain('gateway-ws');

    // RLS via the key: another org's key sees only its own (empty) list.
    const foreign = await app.request('/v1/workspaces', { headers: otherAuth });
    expect(await foreign.json()).toEqual([]);
  });

  it('replays POSTs with the same Idempotency-Key without re-executing', async () => {
    const headers = { ...auth, 'content-type': 'application/json', 'idempotency-key': 'idem-1' };
    const body = JSON.stringify({ name: 'Once', slug: 'once' });
    const first = await app.request('/v1/workspaces', { method: 'POST', headers, body });
    expect(first.status).toBe(201);
    const second = await app.request('/v1/workspaces', { method: 'POST', headers, body });
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(await second.json()).toEqual(await first.json());
    expect(await admin.workspace.count({ where: { slug: 'once' } })).toBe(1);
  });

  it('returns 409 problem on duplicate slug', async () => {
    const headers = { ...auth, 'content-type': 'application/json' };
    const body = JSON.stringify({ name: 'Dup', slug: 'gateway-ws' });
    const dup = await app.request('/v1/workspaces', { method: 'POST', headers, body });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { type: string }).type).toBe('urn:helio:problem:http_409');
  });

  it('enforces the rate limit with standard headers', async () => {
    // Isolated instance with its own counter store and a budget of 2.
    const limited = createApp({
      prisma: createPrismaClient(
        (() => {
          const url = new URL(container.getConnectionUri());
          url.username = 'helio_app';
          url.password = 'helio_app';
          return url.toString();
        })(),
      ),
      // ioredis-mock shares one keyspace across instances; a distinct store
      // gives this test its own limiter bucket.
      redis: new RedisMock() as unknown as RedisLike,
      rateLimit: { max: 2, windowSeconds: 3600 },
    });
    const call = () => limited.request('/v1/workspaces', { headers: rateLimitAuth });
    expect((await call()).status).toBe(200);
    const second = await call();
    expect(second.status).toBe(200);
    expect(second.headers.get('ratelimit-remaining')).toBe('0');
    const third = await call();
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBeTruthy();
    expect(((await third.json()) as { type: string }).type).toBe('urn:helio:problem:http_429');
  });

  describe('contacts', () => {
    type ContactDto = {
      id: string;
      organizationId: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      status: string;
      attributes: Record<string, unknown>;
    };
    let contactId: string;

    it('creates a contact, normalizing the email, scoped to the key’s org', async () => {
      const res = await app.request('/v1/contacts', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: contactWsId,
          email: 'Jane@Example.com',
          firstName: 'Jane',
          attributes: { plan: 'trial' },
        }),
      });
      expect(res.status).toBe(201);
      const contact = (await res.json()) as ContactDto;
      expect(contact.id.startsWith('contact_')).toBe(true);
      expect(contact.email).toBe('jane@example.com');
      expect(contact.organizationId).toBe(orgId);
      expect(contact.status).toBe('ACTIVE');
      expect(contact.attributes).toEqual({ plan: 'trial' });
      contactId = contact.id;
    });

    it('rejects a create for an unknown workspace with 404', async () => {
      const res = await app.request('/v1/contacts', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws_missing', email: 'nobody@example.com' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 409 on a duplicate email in the same workspace', async () => {
      const res = await app.request('/v1/contacts', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: contactWsId, email: 'jane@example.com' }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { type: string }).type).toBe('urn:helio:problem:http_409');
    });

    it('retrieves a contact by id', async () => {
      const res = await app.request(`/v1/contacts/${contactId}`, { headers: auth });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ContactDto).email).toBe('jane@example.com');
    });

    it('lists and searches contacts in a workspace', async () => {
      const list = await app.request(`/v1/contacts?workspaceId=${contactWsId}`, { headers: auth });
      expect(list.status).toBe(200);
      const body = (await list.json()) as { data: ContactDto[]; nextCursor: string | null };
      expect(body.data.map((contact) => contact.email)).toContain('jane@example.com');
      expect(body).toHaveProperty('nextCursor');

      const searched = await app.request(`/v1/contacts?workspaceId=${contactWsId}&search=JANE`, {
        headers: auth,
      });
      const searchedBody = (await searched.json()) as { data: ContactDto[] };
      expect(searchedBody.data.map((contact) => contact.email)).toContain('jane@example.com');
    });

    it('filters by list membership', async () => {
      const listId = newId('list');
      await admin.contactList.create({
        data: { id: listId, organizationId: orgId, workspaceId: contactWsId, name: 'VIPs' },
      });
      await admin.contactListMember.create({
        data: { listId, contactId, organizationId: orgId },
      });
      const res = await app.request(`/v1/contacts?listId=${listId}`, { headers: auth });
      const body = (await res.json()) as { data: ContactDto[] };
      expect(body.data.map((contact) => contact.id)).toEqual([contactId]);
    });

    it('updates a contact and clears a field with null', async () => {
      const res = await app.request(`/v1/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ firstName: null, lastName: 'Doe', status: 'UNSUBSCRIBED' }),
      });
      expect(res.status).toBe(200);
      const contact = (await res.json()) as ContactDto;
      expect(contact.firstName).toBeNull();
      expect(contact.lastName).toBe('Doe');
      expect(contact.status).toBe('UNSUBSCRIBED');
    });

    it('isolates contacts across orgs (RLS)', async () => {
      const res = await app.request(`/v1/contacts/${contactId}`, { headers: otherAuth });
      expect(res.status).toBe(404);
    });

    it('deletes a contact, then 404s on it', async () => {
      const del = await app.request(`/v1/contacts/${contactId}`, {
        method: 'DELETE',
        headers: auth,
      });
      expect(del.status).toBe(204);
      const after = await app.request(`/v1/contacts/${contactId}`, { headers: auth });
      expect(after.status).toBe(404);
    });

    it('paginates with a stable cursor', async () => {
      const pageWs = newId('ws');
      await admin.workspace.create({
        data: { id: pageWs, organizationId: orgId, name: 'Page WS', slug: 'page-ws' },
      });
      await admin.contact.createMany({
        data: Array.from({ length: 3 }, (_, index) => ({
          id: newId('contact'),
          organizationId: orgId,
          workspaceId: pageWs,
          email: `p${index}@example.com`,
        })),
      });
      const first = await app.request(`/v1/contacts?workspaceId=${pageWs}&limit=2`, {
        headers: auth,
      });
      const firstBody = (await first.json()) as { data: ContactDto[]; nextCursor: string | null };
      expect(firstBody.data).toHaveLength(2);
      expect(firstBody.nextCursor).toBeTruthy();
      const second = await app.request(
        `/v1/contacts?workspaceId=${pageWs}&limit=2&cursor=${firstBody.nextCursor}`,
        { headers: auth },
      );
      const secondBody = (await second.json()) as { data: ContactDto[]; nextCursor: string | null };
      expect(secondBody.data).toHaveLength(1);
      expect(secondBody.nextCursor).toBeNull();
      expect(firstBody.data.map((contact) => contact.id)).not.toContain(secondBody.data[0]!.id);
    });

    it('enforces the plan contact cap on create', async () => {
      const capOrgId = newId('org');
      await admin.organization.create({ data: { id: capOrgId, name: 'Cap Org', slug: 'cap-org' } });
      const wsId = newId('ws');
      await admin.workspace.create({
        data: { id: wsId, organizationId: capOrgId, name: 'Cap WS', slug: 'cap-ws' },
      });
      // FREE caps at 1,000 contacts; fill it so the next create is over.
      await admin.subscription.create({
        data: { id: newId('sub'), organizationId: capOrgId, plan: 'FREE' },
      });
      await admin.contact.createMany({
        data: Array.from({ length: 1_000 }, (_, index) => ({
          id: newId('contact'),
          organizationId: capOrgId,
          workspaceId: wsId,
          email: `cap${index}@example.com`,
        })),
      });
      const capKey = await generateGatewayApiKey(capOrgId);
      await admin.gatewayApiKey.create({
        data: {
          id: newId('gwk'),
          organizationId: capOrgId,
          name: 'cap',
          keyHash: capKey.keyHash,
          prefix: capKey.prefix,
        },
      });
      const res = await app.request('/v1/contacts', {
        method: 'POST',
        headers: { authorization: `Bearer ${capKey.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, email: 'one-too-many@example.com' }),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { type: string }).type).toBe('urn:helio:problem:http_403');
    });
  });

  describe('lists', () => {
    type ListDto = {
      id: string;
      organizationId: string;
      workspaceId: string;
      name: string;
      memberCount: number;
    };
    let listId: string;
    let memberA: string;
    let memberB: string;

    beforeAll(async () => {
      memberA = newId('contact');
      memberB = newId('contact');
      await admin.contact.createMany({
        data: [
          { id: memberA, organizationId: orgId, workspaceId: contactWsId, email: 'm1@example.com' },
          { id: memberB, organizationId: orgId, workspaceId: contactWsId, email: 'm2@example.com' },
        ],
      });
    });

    it('creates a list', async () => {
      const res = await app.request('/v1/lists', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: contactWsId, name: 'VIP customers' }),
      });
      expect(res.status).toBe(201);
      const list = (await res.json()) as ListDto;
      expect(list.id.startsWith('list_')).toBe(true);
      expect(list.organizationId).toBe(orgId);
      expect(list.memberCount).toBe(0);
      listId = list.id;
    });

    it('404s creating a list in an unknown workspace', async () => {
      const res = await app.request('/v1/lists', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws_missing', name: 'Orphans' }),
      });
      expect(res.status).toBe(404);
    });

    it('409s on a duplicate list name in the workspace', async () => {
      const res = await app.request('/v1/lists', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: contactWsId, name: 'VIP customers' }),
      });
      expect(res.status).toBe(409);
    });

    it('adds members, skipping duplicates and foreign ids', async () => {
      const res = await app.request(`/v1/lists/${listId}/members`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ contactIds: [memberA, memberB, 'contact_not_real'] }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { added: number }).added).toBe(2);

      const again = await app.request(`/v1/lists/${listId}/members`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ contactIds: [memberA] }),
      });
      expect(((await again.json()) as { added: number }).added).toBe(0);
    });

    it('reflects the member count and powers the contacts list filter', async () => {
      const list = await app.request(`/v1/lists/${listId}`, { headers: auth });
      expect(((await list.json()) as ListDto).memberCount).toBe(2);
      const contacts = await app.request(`/v1/contacts?listId=${listId}`, { headers: auth });
      const body = (await contacts.json()) as { data: { email: string }[] };
      expect(body.data.map((contact) => contact.email).sort()).toEqual([
        'm1@example.com',
        'm2@example.com',
      ]);
    });

    it('lists contact lists in a workspace', async () => {
      const res = await app.request(`/v1/lists?workspaceId=${contactWsId}`, { headers: auth });
      const body = (await res.json()) as { data: ListDto[]; nextCursor: string | null };
      expect(body.data.map((list) => list.id)).toContain(listId);
      expect(body).toHaveProperty('nextCursor');
    });

    it('isolates lists across orgs (RLS)', async () => {
      const res = await app.request(`/v1/lists/${listId}`, { headers: otherAuth });
      expect(res.status).toBe(404);
    });

    it('removes a member, then 404s on a non-member', async () => {
      const removed = await app.request(`/v1/lists/${listId}/members/${memberA}`, {
        method: 'DELETE',
        headers: auth,
      });
      expect(removed.status).toBe(204);
      const again = await app.request(`/v1/lists/${listId}/members/${memberA}`, {
        method: 'DELETE',
        headers: auth,
      });
      expect(again.status).toBe(404);
      const list = await app.request(`/v1/lists/${listId}`, { headers: auth });
      expect(((await list.json()) as ListDto).memberCount).toBe(1);
    });

    it('adds no members when every id is foreign', async () => {
      const res = await app.request(`/v1/lists/${listId}/members`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ contactIds: ['contact_ghost1', 'contact_ghost2'] }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { added: number }).added).toBe(0);
    });

    it('404s touching members of a missing list', async () => {
      const add = await app.request('/v1/lists/list_missing/members', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ contactIds: [memberB] }),
      });
      expect(add.status).toBe(404);
      const remove = await app.request('/v1/lists/list_missing/members/contact_x', {
        method: 'DELETE',
        headers: auth,
      });
      expect(remove.status).toBe(404);
    });

    it('paginates lists and lists across the org without a filter', async () => {
      const pageWs = newId('ws');
      await admin.workspace.create({
        data: { id: pageWs, organizationId: orgId, name: 'List Page WS', slug: 'list-page-ws' },
      });
      await admin.contactList.createMany({
        data: Array.from({ length: 3 }, (_, index) => ({
          id: newId('list'),
          organizationId: orgId,
          workspaceId: pageWs,
          name: `L${index}`,
        })),
      });
      const first = await app.request(`/v1/lists?workspaceId=${pageWs}&limit=2`, { headers: auth });
      const firstBody = (await first.json()) as { data: ListDto[]; nextCursor: string | null };
      expect(firstBody.data).toHaveLength(2);
      expect(firstBody.nextCursor).toBeTruthy();
      const second = await app.request(
        `/v1/lists?workspaceId=${pageWs}&limit=2&cursor=${firstBody.nextCursor}`,
        { headers: auth },
      );
      const secondBody = (await second.json()) as { data: ListDto[]; nextCursor: string | null };
      expect(secondBody.data).toHaveLength(1);
      expect(secondBody.nextCursor).toBeNull();

      // No workspace filter → lists across the whole org.
      const all = await app.request('/v1/lists?limit=100', { headers: auth });
      expect(all.status).toBe(200);
    });

    it('deletes a list, cascading its memberships', async () => {
      const del = await app.request(`/v1/lists/${listId}`, { method: 'DELETE', headers: auth });
      expect(del.status).toBe(204);
      const after = await app.request(`/v1/lists/${listId}`, { headers: auth });
      expect(after.status).toBe(404);
      expect(await admin.contactListMember.count({ where: { listId } })).toBe(0);
    });
  });

  it('committed OpenAPI document matches the code', async () => {
    const served = await app.request('/openapi.json');
    const servedDoc = (await served.json()) as { paths: unknown; components: unknown };
    const committed = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../openapi.json'), 'utf8'),
    );
    expect(servedDoc.paths).toEqual(committed.paths);
    expect(servedDoc.components).toEqual(committed.components);
  });
});
