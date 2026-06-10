import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from '../src/rate-limit';

// A fixed instant 10s into a minute window, so retry-after math is exact.
const now = Date.UTC(2026, 5, 10, 12, 0, 10);

describe('FixedWindowRateLimiter', () => {
  it('allows up to max requests and denies the next one', () => {
    const limiter = new FixedWindowRateLimiter({ max: 3, windowSeconds: 60 });
    expect(limiter.check('ip', now).allowed).toBe(true);
    expect(limiter.check('ip', now).allowed).toBe(true);
    expect(limiter.check('ip', now).allowed).toBe(true);
    expect(limiter.check('ip', now).allowed).toBe(false);
  });

  it('counts remaining down to zero and never below', () => {
    const limiter = new FixedWindowRateLimiter({ max: 2, windowSeconds: 60 });
    expect(limiter.check('ip', now).remaining).toBe(1);
    expect(limiter.check('ip', now).remaining).toBe(0);
    expect(limiter.check('ip', now).remaining).toBe(0);
  });

  it('keeps separate keys on separate budgets', () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowSeconds: 60 });
    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now).allowed).toBe(false);
    expect(limiter.check('b', now).allowed).toBe(true);
  });

  it('resets the budget when the window rolls over', () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowSeconds: 60 });
    expect(limiter.check('ip', now).allowed).toBe(true);
    expect(limiter.check('ip', now).allowed).toBe(false);
    const nextWindow = now + 60_000;
    expect(limiter.check('ip', nextWindow).allowed).toBe(true);
  });

  it('answers retry-after as the seconds left in the window', () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowSeconds: 60 });
    // 10s into the window → 50s remain.
    expect(limiter.check('ip', now).retryAfterSeconds).toBe(50);
  });

  it('never answers a retry-after below one second', () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowSeconds: 60 });
    const lastMoment = Date.UTC(2026, 5, 10, 12, 0, 59) + 999;
    expect(limiter.check('ip', lastMoment).retryAfterSeconds).toBe(1);
  });

  it('reports the configured limit on every decision', () => {
    const limiter = new FixedWindowRateLimiter({ max: 7, windowSeconds: 60 });
    expect(limiter.check('ip', now).limit).toBe(7);
  });

  it('evicts the longest-tracked key once maxKeys is reached', () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowSeconds: 60, maxKeys: 2 });
    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('b', now).allowed).toBe(true);
    // Inserting "c" evicts "a", the longest-tracked key.
    expect(limiter.check('c', now).allowed).toBe(true);
    // "b" survived the eviction, so its spent budget still stands…
    expect(limiter.check('b', now).allowed).toBe(false);
    // …while the evicted "a" starts over on a fresh budget.
    expect(limiter.check('a', now).allowed).toBe(true);
  });

  it('does not evict when an already-tracked key checks in at capacity', () => {
    const limiter = new FixedWindowRateLimiter({ max: 3, windowSeconds: 60, maxKeys: 2 });
    limiter.check('a', now);
    limiter.check('b', now);
    limiter.check('a', now);
    // "a" was counted twice — proof it kept its slot at capacity.
    expect(limiter.check('a', now).remaining).toBe(0);
  });
});
