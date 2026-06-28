import { describe, expect, it, vi } from 'vitest';

import { createJourneyActivities } from '../src/journey-activities';
import { InMemorySmsProvider, type SmsProvider } from '../src/sms-provider';

const active = {
  id: 'c1',
  organizationId: 'org1',
  workspaceId: 'ws1',
  status: 'ACTIVE',
  phone: '+15555551234',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: null,
  attributes: {},
};

function activitiesFor(contact: unknown, sms?: SmsProvider, claimStatus = 'PENDING') {
  const prisma = {
    contact: { findUnique: vi.fn(async () => contact) },
    journeyDelivery: {
      upsert: vi.fn(async () => ({ status: claimStatus })),
      update: vi.fn(async () => ({})),
    },
  } as never;
  return createJourneyActivities(prisma, {} as never, {} as never, undefined, async () => sms);
}

describe('sendJourneySms', () => {
  it('texts an active contact with a phone, personalizing the body', async () => {
    const sms = new InMemorySmsProvider();
    const result = await activitiesFor(active, sms).sendJourneySms(
      'c1',
      'Hi {{firstName}}',
      'run1',
      'node1',
    );
    expect(result).toEqual({ sent: 1 });
    expect(sms.sent).toEqual([{ to: '+15555551234', body: 'Hi Ada' }]);
  });

  it('does not re-send when a prior attempt already delivered (retry idempotency)', async () => {
    const sms = new InMemorySmsProvider();
    // The claim row is already SENT (a previous activity attempt delivered).
    const result = await activitiesFor(active, sms, 'SENT').sendJourneySms(
      'c1',
      'Hi',
      'run1',
      'node1',
    );
    expect(result).toEqual({ sent: 1 });
    expect(sms.sent).toHaveLength(0); // the provider was never called again
  });

  it('skips suppressed, phoneless, missing, or unconfigured sends', async () => {
    const sms = new InMemorySmsProvider();
    expect(
      (
        await activitiesFor({ ...active, status: 'UNSUBSCRIBED' }, sms).sendJourneySms(
          'c',
          'x',
          'run1',
          'node1',
        )
      ).sent,
    ).toBe(0);
    expect(
      (
        await activitiesFor({ ...active, phone: null }, sms).sendJourneySms(
          'c',
          'x',
          'run1',
          'node1',
        )
      ).sent,
    ).toBe(0);
    expect((await activitiesFor(null, sms).sendJourneySms('c', 'x', 'run1', 'node1')).sent).toBe(0);
    // No SMS provider configured at all.
    expect(
      (await activitiesFor(active, undefined).sendJourneySms('c', 'x', 'run1', 'node1')).sent,
    ).toBe(0);
    expect(sms.sent).toHaveLength(0);
  });
});
