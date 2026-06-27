import { createHash } from 'node:crypto';

import { FixedWindowRateLimiter } from '@helio/core';
import { trace } from '@opentelemetry/api';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import type { RedisLike } from '../types';

/**
 * Fixed-window limiter keyed by caller credential (falls back to IP).
 * Counts live in Redis so every gateway replica shares the budget.
 *
 * If Redis is unreachable the middleware does not fail the request (a Redis
 * blip would otherwise 500 the whole API); it degrades to a per-replica
 * in-memory window of the same shape, so a budget is still enforced, and flags
 * the outage on the active trace.
 */
export function rateLimit(redis: RedisLike, options: { max: number; windowSeconds: number }) {
  const fallback = new FixedWindowRateLimiter({
    max: options.max,
    windowSeconds: options.windowSeconds,
  });

  return createMiddleware(async (c, next) => {
    const credential =
      c.req.header('authorization') ??
      c.req.header('x-forwarded-for') ??
      c.req.header('x-real-ip') ??
      'anonymous';
    // Never persist the live API secret in a Redis key — fingerprint it.
    const caller = createHash('sha256').update(credential).digest('hex').slice(0, 32);

    let exceeded: boolean;
    let remaining: number;
    let retryAfter = options.windowSeconds;

    try {
      const window = Math.floor(Date.now() / 1000 / options.windowSeconds);
      const key = `ratelimit:${window}:${caller}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, options.windowSeconds);
      }
      exceeded = count > options.max;
      remaining = Math.max(0, options.max - count);
      if (exceeded) {
        retryAfter = Math.max(1, await redis.ttl(key));
      }
    } catch (error) {
      trace.getActiveSpan()?.addEvent('ratelimit.redis_unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      const decision = fallback.check(caller);
      exceeded = !decision.allowed;
      remaining = decision.remaining;
      retryAfter = decision.retryAfterSeconds;
    }

    c.header('RateLimit-Limit', String(options.max));
    c.header('RateLimit-Remaining', String(remaining));

    if (exceeded) {
      c.header('Retry-After', String(Math.max(1, retryAfter)));
      throw new HTTPException(429, { message: 'rate limit exceeded' });
    }
    await next();
  });
}
