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
