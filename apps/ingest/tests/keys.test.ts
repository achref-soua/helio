import { describe, expect, it, vi } from 'vitest';

import { PrismaWriteKeyResolver } from '../src/keys';

function makePrisma(
  rows: Record<string, { organizationId: string; workspaceId: string; revokedAt: Date | null }>,
) {
  const findUnique = vi.fn(({ where }: { where: { key: string } }) =>
    Promise.resolve(rows[where.key] ? { key: where.key, ...rows[where.key] } : null),
  );
  return { prisma: { writeKey: { findUnique } } as never, findUnique };
}

describe('PrismaWriteKeyResolver', () => {
  it('resolves an active key and caches the lookup', async () => {
    const { prisma, findUnique } = makePrisma({
      wk_live: { organizationId: 'org_1', workspaceId: 'ws_1', revokedAt: null },
    });
    const resolver = new PrismaWriteKeyResolver(prisma, 60_000);

    const first = await resolver.resolve('wk_live');
    const second = await resolver.resolve('wk_live');
    expect(first).toEqual({ organizationId: 'org_1', workspaceId: 'ws_1' });
    expect(second).toEqual(first);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('returns null for unknown and revoked keys, caching the negative', async () => {
    const { prisma, findUnique } = makePrisma({
      wk_revoked: { organizationId: 'org_1', workspaceId: 'ws_1', revokedAt: new Date() },
    });
    const resolver = new PrismaWriteKeyResolver(prisma, 60_000);

    expect(await resolver.resolve('wk_revoked')).toBeNull();
    expect(await resolver.resolve('wk_missing')).toBeNull();
    expect(await resolver.resolve('wk_missing')).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('re-queries once the TTL expires', async () => {
    let nowMs = 0;
    const { prisma, findUnique } = makePrisma({
      wk_live: { organizationId: 'org_1', workspaceId: 'ws_1', revokedAt: null },
    });
    const resolver = new PrismaWriteKeyResolver(prisma, 1_000, () => nowMs);

    await resolver.resolve('wk_live');
    nowMs = 999;
    await resolver.resolve('wk_live');
    expect(findUnique).toHaveBeenCalledTimes(1);

    nowMs = 1_001;
    await resolver.resolve('wk_live');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
