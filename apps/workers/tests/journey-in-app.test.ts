import { describe, expect, it, vi } from 'vitest';

import { createJourneyActivities } from '../src/journey-activities';

const active = { id: 'c1', status: 'ACTIVE', organizationId: 'org1', workspaceId: 'ws1' };

function activitiesFor(contact: unknown, message: unknown) {
  const upsert = vi.fn(async () => ({ id: 'iad_1' }));
  const prisma = {
    contact: { findUnique: vi.fn(async () => contact) },
    inAppMessage: { findFirst: vi.fn(async () => message) },
    inAppDelivery: { upsert },
  } as never;
  return { activities: createJourneyActivities(prisma, {} as never, {} as never), upsert };
}

describe('sendJourneyInApp', () => {
  it('queues a delivery for an active contact and a live message', async () => {
    const { activities, upsert } = activitiesFor(active, { id: 'iam_1' });
    const result = await activities.sendJourneyInApp('c1', 'iam_1', 'run1', 'n1');
    expect(result).toEqual({ queued: 1 });
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expect.stringMatching(/^iad_/) },
        create: expect.objectContaining({
          organizationId: 'org1',
          workspaceId: 'ws1',
          messageId: 'iam_1',
          contactId: 'c1',
        }),
      }),
    );
  });

  it('claims a stable id for the same run+node (idempotent under retries)', async () => {
    const { activities, upsert } = activitiesFor(active, { id: 'iam_1' });
    await activities.sendJourneyInApp('c1', 'iam_1', 'run9', 'node9');
    await activities.sendJourneyInApp('c1', 'iam_1', 'run9', 'node9');
    const calls = upsert.mock.calls as unknown as Array<[{ where: { id: string } }]>;
    const ids = calls.map((call) => call[0].where.id);
    expect(ids[0]).toBe(ids[1]);
  });

  it('skips suppressed contacts, missing contacts, and missing/paused messages', async () => {
    expect(
      (await activitiesFor(null, { id: 'iam_1' }).activities.sendJourneyInApp('c', 'm', 'r', 'n'))
        .queued,
    ).toBe(0);
    expect(
      (
        await activitiesFor(
          { ...active, status: 'UNSUBSCRIBED' },
          { id: 'iam_1' },
        ).activities.sendJourneyInApp('c', 'm', 'r', 'n')
      ).queued,
    ).toBe(0);
    const paused = activitiesFor(active, null);
    expect((await paused.activities.sendJourneyInApp('c', 'm', 'r', 'n')).queued).toBe(0);
    expect(paused.upsert).not.toHaveBeenCalled();
  });
});
