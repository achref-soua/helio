import { describe, expect, it, vi } from 'vitest';

import { PrismaSendResolver } from '../src/sends';

function makePrisma(rows: Record<string, object>) {
  const findUnique = vi.fn(({ where }: { where: { id: string } }) =>
    Promise.resolve(rows[where.id] ?? null),
  );
  return { prisma: { emailSend: { findUnique } } as never, findUnique };
}

const ROW = {
  organizationId: 'org_1',
  workspaceId: 'ws_1',
  contactId: 'contact_1',
  email: 'ada@example.com',
  campaignId: null,
};

describe('PrismaSendResolver', () => {
  it('resolves and caches sends, including negatives', async () => {
    const { prisma, findUnique } = makePrisma({ snd_1: ROW });
    const resolver = new PrismaSendResolver(prisma, 60_000);

    expect(await resolver.resolve('snd_1')).toEqual(ROW);
    expect(await resolver.resolve('snd_1')).toEqual(ROW);
    expect(await resolver.resolve('snd_missing')).toBeNull();
    expect(await resolver.resolve('snd_missing')).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('re-queries after the TTL', async () => {
    let nowMs = 0;
    const { prisma, findUnique } = makePrisma({ snd_1: ROW });
    const resolver = new PrismaSendResolver(prisma, 1_000, () => nowMs);
    await resolver.resolve('snd_1');
    nowMs = 1_001;
    await resolver.resolve('snd_1');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
