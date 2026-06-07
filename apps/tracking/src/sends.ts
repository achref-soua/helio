import type { PrismaClient } from '@helio/db';

import type { ResolvedSend, SendResolver } from './types';

interface CacheEntry {
  value: ResolvedSend | null;
  expiresAt: number;
}

/**
 * Send lookup with a small in-process TTL cache: opens arrive in bursts
 * (an inbox provider fetching images for thousands of recipients), and
 * the row is immutable once written. Negative results cache too.
 */
export class PrismaSendResolver implements SendResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: Pick<PrismaClient, 'emailSend'>,
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(sendId: string): Promise<ResolvedSend | null> {
    const cached = this.cache.get(sendId);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const row = await this.prisma.emailSend.findUnique({
      where: { id: sendId },
      select: {
        organizationId: true,
        workspaceId: true,
        contactId: true,
        email: true,
        campaignId: true,
      },
    });
    const value = row ?? null;

    if (this.cache.size >= 50_000) this.cache.clear();
    this.cache.set(sendId, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}
