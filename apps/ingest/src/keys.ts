import type { PrismaClient } from '@helio/db';

import type { ResolvedWriteKey, WriteKeyResolver } from './types';

interface CacheEntry {
  value: ResolvedWriteKey | null;
  expiresAt: number;
}

/**
 * Write-key lookup with a small in-process TTL cache, keeping Postgres
 * off the hot path. Negative results are cached too, so unknown keys
 * cannot hammer the database. Revocation therefore propagates within
 * `ttlMs` per instance — acceptable for an analytics write credential.
 */
export class PrismaWriteKeyResolver implements WriteKeyResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: Pick<PrismaClient, 'writeKey'>,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(key: string): Promise<ResolvedWriteKey | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const row = await this.prisma.writeKey.findUnique({ where: { key } });
    const value =
      row && row.revokedAt === null
        ? { organizationId: row.organizationId, workspaceId: row.workspaceId }
        : null;

    // Bound the cache so a flood of unknown keys cannot grow it unbounded.
    if (this.cache.size >= 10_000) this.cache.clear();
    this.cache.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}
