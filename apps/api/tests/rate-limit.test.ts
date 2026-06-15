import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { rateLimit } from '../src/middleware/rate-limit';
import type { RedisLike } from '../src/types';

function appWith(redis: RedisLike) {
  const app = new Hono();
  app.use('*', rateLimit(redis, { max: 2, windowSeconds: 60 }));
  app.get('/', (c) => c.text('ok'));
  return app;
}

function countingRedis(): RedisLike {
  const store = new Map<string, number>();
  return {
    incr: async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    expire: async () => 1,
    ttl: async () => 60,
    get: async () => null,
    set: async () => 'OK',
    ping: async () => 'PONG',
  } as unknown as RedisLike;
}

function brokenRedis(): RedisLike {
  const down = async () => {
    throw new Error('ECONNREFUSED');
  };
  return {
    incr: down,
    expire: down,
    ttl: down,
    get: down,
    set: down,
    ping: down,
  } as unknown as RedisLike;
}

const auth = (key: string) => ({ headers: { authorization: key } });

describe('rate-limit middleware', () => {
  it('allows up to the limit, then 429s with Retry-After', async () => {
    const app = appWith(countingRedis());
    expect((await app.request('/', auth('k1'))).status).toBe(200);
    expect((await app.request('/', auth('k1'))).status).toBe(200);
    const limited = await app.request('/', auth('k1'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(limited.headers.get('ratelimit-limit')).toBe('2');
  });

  it('tracks budgets per credential', async () => {
    const app = appWith(countingRedis());
    await app.request('/', auth('a'));
    await app.request('/', auth('a'));
    expect((await app.request('/', auth('a'))).status).toBe(429);
    // A different credential still has its full budget.
    expect((await app.request('/', auth('b'))).status).toBe(200);
  });

  it('degrades to an in-memory limit when Redis is down (no 500)', async () => {
    const app = appWith(brokenRedis());
    expect((await app.request('/', auth('k2'))).status).toBe(200);
    expect((await app.request('/', auth('k2'))).status).toBe(200);
    // The fallback still enforces the window — a Redis outage must not 500
    // every request, nor lift the limit entirely.
    expect((await app.request('/', auth('k2'))).status).toBe(429);
  });
});
