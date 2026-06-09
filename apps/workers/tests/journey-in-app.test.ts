import { describe, expect, it, vi } from 'vitest';

import { createJourneyActivities } from '../src/journey-activities';

const active = { id: 'c1', status: 'ACTIVE', organizationId: 'org1', workspaceId: 'ws1' };

function activitiesFor(contact: unknown, message: unknown) {
  const create = vi.fn(async () => ({ id: 'iad_1' }));
  const prisma = {
    contact: { findUnique: vi.fn(async () => contact) },
    inAppMessage: { findFirst: vi.fn(async () => message) },
    inAppDelivery: { create },
  } as never;
  return { activities: createJourneyActivities(prisma, {} as never, {} as never), create };
}

describe('sendJourneyInApp', () => {
  it('queues a delivery for an active contact and a live message', async () => {
    const { activities, create } = activitiesFor(active, { id: 'iam_1' });
    const result = await activities.sendJourneyInApp('c1', 'iam_1');
    expect(result).toEqual({ queued: 1 });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org1',
        workspaceId: 'ws1',
        messageId: 'iam_1',
        contactId: 'c1',
      }),
    });
  });

  it('skips suppressed contacts, missing contacts, and missing/paused messages', async () => {
    expect(
      (await activitiesFor(null, { id: 'iam_1' }).activities.sendJourneyInApp('c', 'm')).queued,
    ).toBe(0);
    expect(
      (
        await activitiesFor(
          { ...active, status: 'UNSUBSCRIBED' },
          { id: 'iam_1' },
        ).activities.sendJourneyInApp('c', 'm')
      ).queued,
    ).toBe(0);
    const paused = activitiesFor(active, null);
    expect((await paused.activities.sendJourneyInApp('c', 'm')).queued).toBe(0);
    expect(paused.create).not.toHaveBeenCalled();
  });
});
