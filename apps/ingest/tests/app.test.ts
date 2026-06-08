import { InMemoryEventProducer } from '@helio/bus';
import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import type { RedisLike, ResolvedWriteKey, WriteKeyResolver } from '../src/types';

const KNOWN = 'wk_test_aaaaaaaaaaaaaaaaaaaaaaaaa';
const SCOPE: ResolvedWriteKey = { organizationId: 'org_1', workspaceId: 'ws_1' };

const staticResolver: WriteKeyResolver = {
  resolve: (key) => Promise.resolve(key === KNOWN ? SCOPE : null),
};

function makeApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const producer = new InMemoryEventProducer();
  const app = createApp({
    keys: staticResolver,
    producer,
    // ioredis-mock instances share one store, so rate-limit counters
    // accumulate across tests — keep the default budget out of reach.
    redis: new RedisMock() as unknown as RedisLike,
    rateLimit: { max: 10_000, windowSeconds: 3600 },
    now: () => new Date('2026-06-08T10:00:00.000Z'),
    ...overrides,
  });
  return { app, producer };
}

function post(
  app: ReturnType<typeof makeApp>['app'],
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request('/v1/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const goodBatch = {
  batch: [{ type: 'track', event: 'Signed Up', anonymousId: 'anon-1' }],
};

describe('ingest app', () => {
  let app: ReturnType<typeof makeApp>['app'];
  let producer: InMemoryEventProducer;

  beforeEach(() => {
    ({ app, producer } = makeApp());
  });

  it('healthz is public', async () => {
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
  });

  it('readyz aggregates probes and reports degradation', async () => {
    const failing = makeApp({
      readiness: { clickhouse: () => Promise.reject(new Error('down')) },
    }).app;
    const degraded = await failing.request('/readyz');
    expect(degraded.status).toBe(503);
    expect(await degraded.json()).toMatchObject({
      status: 'degraded',
      checks: { redis: 'ok', clickhouse: 'failed' },
    });

    const healthy = await app.request('/readyz');
    expect(healthy.status).toBe(200);
  });

  it('rejects requests without a write key as problem+json', async () => {
    const response = await post(app, goodBatch);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({ status: 401 });
  });

  it('rejects unknown keys', async () => {
    const response = await post(app, goodBatch, { 'x-write-key': 'wk_nope' });
    expect(response.status).toBe(401);
  });

  it('accepts the key via Basic auth username (Segment style)', async () => {
    const response = await post(app, goodBatch, {
      authorization: `Basic ${Buffer.from(`${KNOWN}:`).toString('base64')}`,
    });
    expect(response.status).toBe(202);
  });

  it('accepts the key via Bearer, X-Write-Key, and the body', async () => {
    expect((await post(app, goodBatch, { authorization: `Bearer ${KNOWN}` })).status).toBe(202);
    expect((await post(app, goodBatch, { 'x-write-key': KNOWN })).status).toBe(202);
    expect((await post(app, { ...goodBatch, writeKey: KNOWN })).status).toBe(202);
  });

  it('rejects non-JSON bodies with 400', async () => {
    const response = await app.request('/v1/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-write-key': KNOWN },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('rejects invalid batches with 422 and pinpoints the issue', async () => {
    const response = await post(
      app,
      { batch: [{ type: 'track', event: '' }] },
      { 'x-write-key': KNOWN },
    );
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { title: string };
    expect(problem.title).toContain('batch.0');
  });

  it('publishes enriched events stamped with tenancy and server time', async () => {
    const response = await post(
      app,
      {
        batch: [
          { type: 'track', event: 'Signed Up', anonymousId: 'anon-1', properties: { plan: 'pro' } },
          { type: 'identify', userId: 'u-1', traits: { plan: 'pro' } },
        ],
      },
      { 'x-write-key': KNOWN },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 2 });

    expect(producer.published).toHaveLength(2);
    const [track, identify] = producer.published;
    expect(track).toMatchObject({
      organization_id: 'org_1',
      workspace_id: 'ws_1',
      type: 'track',
      event: 'Signed Up',
      received_at: '2026-06-08T10:00:00.000Z',
    });
    expect(track!.message_id).toMatch(/^msg_/);
    expect(identify).toMatchObject({ type: 'identify', user_id: 'u-1' });
  });

  it('surfaces bus failures as 500 problem+json without dropping silently', async () => {
    producer.failNext = true;
    const response = await post(app, goodBatch, { 'x-write-key': KNOWN });
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
  });

  it('rate limits per workspace with Retry-After', async () => {
    // Dedicated workspace so the shared mock store cannot interfere.
    const limitedApp = makeApp({
      keys: {
        resolve: () => Promise.resolve({ organizationId: 'org_rl', workspaceId: 'ws_rl' }),
      },
      rateLimit: { max: 2, windowSeconds: 3600 },
    }).app;
    for (let i = 0; i < 2; i++) {
      expect((await post(limitedApp, goodBatch, { 'x-write-key': KNOWN })).status).toBe(202);
    }
    const limited = await post(limitedApp, goodBatch, { 'x-write-key': KNOWN });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited.headers.get('RateLimit-Remaining')).toBe('0');
  });

  it('answers CORS preflight for browser SDKs', async () => {
    const response = await app.request('/v1/batch', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://customer-site.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-write-key',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://customer-site.test');
  });
});
