export interface RateLimitOptions {
  /** Requests allowed per window. */
  max: number;
  windowSeconds: number;
  /** Distinct keys tracked per window before the oldest is evicted. */
  maxKeys?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets — the Retry-After answer on a 429. */
  retryAfterSeconds: number;
}

/**
 * In-process fixed-window limiter for public surfaces that have no shared
 * store. Mirrors the gateway's Redis fixed window (apps/api rate-limit
 * middleware) so budgets read the same everywhere. Each replica enforces its
 * own budget — a horizontally scaled deployment multiplies the effective
 * limit by the replica count, which is acceptable for abuse damping; the
 * shared-budget paths live on the gateway and ingest services.
 */
export class FixedWindowRateLimiter {
  private windowIndex = -1;
  private counts = new Map<string, number>();
  private readonly maxKeys: number;

  constructor(private readonly options: RateLimitOptions) {
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  check(key: string, nowMs: number = Date.now()): RateLimitDecision {
    const windowMs = this.options.windowSeconds * 1000;
    const windowIndex = Math.floor(nowMs / windowMs);
    if (windowIndex !== this.windowIndex) {
      this.windowIndex = windowIndex;
      this.counts = new Map();
    }

    const previous = this.counts.get(key) ?? 0;
    if (previous === 0 && this.counts.size >= this.maxKeys) {
      // Bound memory under a key flood: drop the longest-tracked key. A
      // flood can only reset budgets inside the current window, and every
      // forged key it inserts still gets counted against the flooder.
      const oldest = this.counts.keys().next().value;
      if (oldest !== undefined) this.counts.delete(oldest);
    }
    const count = previous + 1;
    this.counts.set(key, count);

    const windowEndMs = (windowIndex + 1) * windowMs;
    return {
      allowed: count <= this.options.max,
      limit: this.options.max,
      remaining: Math.max(0, this.options.max - count),
      retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000)),
    };
  }
}
