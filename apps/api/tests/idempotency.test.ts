import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { idempotency } from '../src/middleware/idempotency';
import type { GatewayEnv, RedisLike } from '../src/types';

/** A tiny in-memory Redis with the get/set/EX shape the middleware uses. */
function memRedis(): RedisLike {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    incr: async () => 1,
    expire: async () => 1,
    ttl: async () => 60,
    ping: async () => 'PONG',
  } as unknown as RedisLike;
}

// Stand in for apiKeyAuth: set the org from a header so each request can act as
// a different tenant, exactly as the real middleware order does.
function appFor(redis: RedisLike) {
  const app = new Hono<GatewayEnv>();
  app.use('*', async (c, next) => {
    c.set('organizationId', c.req.header('x-org') ?? 'none');
    await next();
  });
  app.use('*', idempotency(redis));
  let counter = 0;
  app.post('/v1/contacts', (c) => c.json({ org: c.get('organizationId'), n: ++counter }));
  return app;
}

describe('idempotency middleware', () => {
  it('replays the stored response for the same org + key', async () => {
    const app = appFor(memRedis());
    const headers = { 'idempotency-key': 'k1', 'x-org': 'orgA' };
    const first = await app.request('/v1/contacts', { method: 'POST', headers });
    const second = await app.request('/v1/contacts', { method: 'POST', headers });
    expect(await second.json()).toEqual(await first.json());
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('never leaks one tenant response to another sharing the same key', async () => {
    const app = appFor(memRedis());
    const a = await app.request('/v1/contacts', {
      method: 'POST',
      headers: { 'idempotency-key': 'order-123', 'x-org': 'orgA' },
    });
    const b = await app.request('/v1/contacts', {
      method: 'POST',
      headers: { 'idempotency-key': 'order-123', 'x-org': 'orgB' },
    });
    expect(((await a.json()) as { org: string }).org).toBe('orgA');
    // Org B must run its own handler, not receive org A's cached body.
    expect(((await b.json()) as { org: string }).org).toBe('orgB');
    expect(b.headers.get('Idempotency-Replayed')).toBeNull();
  });
});
