import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import type { RedisLike } from '../types';

const TTL_SECONDS = 60 * 60 * 24;

/**
 * Replay protection for mutating endpoints: when a client sends an
 * Idempotency-Key it has used before, the stored response is returned
 * verbatim instead of re-executing the handler.
 */
export function idempotency(redis: RedisLike) {
  return createMiddleware(async (c, next) => {
    if (c.req.method !== 'POST') {
      await next();
      return;
    }
    const key = c.req.header('idempotency-key');
    if (!key) {
      await next();
      return;
    }
    if (key.length > 255) {
      throw new HTTPException(400, { message: 'idempotency key too long' });
    }

    const storageKey = `idempotency:${c.req.path}:${key}`;
    const stored = await redis.get(storageKey);
    if (stored) {
      const { status, body } = JSON.parse(stored) as { status: number; body: string };
      c.header('Idempotency-Replayed', 'true');
      return c.body(body, status as 200, { 'content-type': 'application/json' });
    }

    await next();

    if (c.res.status >= 200 && c.res.status < 300) {
      const body = await c.res.clone().text();
      await redis.set(
        storageKey,
        JSON.stringify({ status: c.res.status, body }),
        'EX',
        TTL_SECONDS,
      );
    }
  });
}
