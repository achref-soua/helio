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

function memCache() {
  const store = new Map<string, { value: string; ttlMs: number }>();
  const cache = {
    get: vi.fn(async (k: string) => store.get(k)?.value ?? null),
    set: vi.fn(async (k: string, value: string, ttlMs: number) => {
      store.set(k, { value, ttlMs });
    }),
  };
  return { cache, store };
}

describe('PrismaWriteKeyResolver shared L2 cache', () => {
  it('serves from L2 without touching Postgres', async () => {
    const { prisma, findUnique } = makePrisma({});
    const { cache, store } = memCache();
    store.set('wk_live', { value: JSON.stringify({ o: 'org_1', w: 'ws_1' }), ttlMs: 60_000 });
    const resolver = new PrismaWriteKeyResolver(prisma, 60_000, Date.now, cache);

    expect(await resolver.resolve('wk_live')).toEqual({
      organizationId: 'org_1',
      workspaceId: 'ws_1',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('populates L2 from a database lookup with the positive TTL', async () => {
    const { prisma } = makePrisma({
      wk_live: { organizationId: 'org_1', workspaceId: 'ws_1', revokedAt: null },
    });
    const { cache } = memCache();
    const resolver = new PrismaWriteKeyResolver(prisma, 60_000, Date.now, cache, 5_000);

    await resolver.resolve('wk_live');
    expect(cache.set).toHaveBeenCalledWith(
      'wk_live',
      JSON.stringify({ o: 'org_1', w: 'ws_1' }),
      60_000,
    );
  });

  it('caches a negative result in L2 with the short TTL', async () => {
    const { prisma } = makePrisma({});
    const { cache } = memCache();
    const resolver = new PrismaWriteKeyResolver(prisma, 60_000, Date.now, cache, 5_000);

    expect(await resolver.resolve('wk_missing')).toBeNull();
    expect(cache.set).toHaveBeenCalledWith('wk_missing', expect.any(String), 5_000);
  });

  it('fails open to Postgres when L2 errors', async () => {
    const { prisma, findUnique } = makePrisma({
      wk_live: { organizationId: 'org_1', workspaceId: 'ws_1', revokedAt: null },
    });
    const cache = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
      set: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const resolver = new PrismaWriteKeyResolver(prisma, 60_000, Date.now, cache);

    expect(await resolver.resolve('wk_live')).toEqual({
      organizationId: 'org_1',
      workspaceId: 'ws_1',
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('never crosses tenants: each key maps to its own workspace through the shared L2', async () => {
    const { prisma } = makePrisma({
      wk_a: { organizationId: 'org_a', workspaceId: 'ws_a', revokedAt: null },
      wk_b: { organizationId: 'org_b', workspaceId: 'ws_b', revokedAt: null },
    });
    const { cache, store } = memCache();
    // Two resolvers with separate L1 maps but the same L2 — like two replicas.
    const r1 = new PrismaWriteKeyResolver(prisma, 60_000, Date.now, cache);
    const r2 = new PrismaWriteKeyResolver(prisma, 60_000, Date.now, cache);

    expect(await r1.resolve('wk_a')).toEqual({ organizationId: 'org_a', workspaceId: 'ws_a' });
    expect(await r1.resolve('wk_b')).toEqual({ organizationId: 'org_b', workspaceId: 'ws_b' });
    // r2 has a cold L1, reads the shared L2, and still gets each key's own workspace.
    expect(await r2.resolve('wk_a')).toEqual({ organizationId: 'org_a', workspaceId: 'ws_a' });
    expect(await r2.resolve('wk_b')).toEqual({ organizationId: 'org_b', workspaceId: 'ws_b' });
    expect(store.get('wk_a')!.value).not.toEqual(store.get('wk_b')!.value);
  });
});
