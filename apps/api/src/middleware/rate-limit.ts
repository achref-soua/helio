import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import type { RedisLike } from '../types';

/**
 * Fixed-window limiter keyed by caller credential (falls back to IP).
 * Counts live in Redis so every gateway replica shares the budget.
 */
export function rateLimit(redis: RedisLike, options: { max: number; windowSeconds: number }) {
  return createMiddleware(async (c, next) => {
    const credential =
      c.req.header('authorization') ??
      c.req.header('x-forwarded-for') ??
      c.req.header('x-real-ip') ??
      'anonymous';
    const window = Math.floor(Date.now() / 1000 / options.windowSeconds);
    const key = `ratelimit:${window}:${credential}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, options.windowSeconds);
    }

    c.header('RateLimit-Limit', String(options.max));
    c.header('RateLimit-Remaining', String(Math.max(0, options.max - count)));

    if (count > options.max) {
      const ttl = await redis.ttl(key);
      c.header('Retry-After', String(Math.max(1, ttl)));
      throw new HTTPException(429, { message: 'rate limit exceeded' });
    }
    await next();
  });
}
