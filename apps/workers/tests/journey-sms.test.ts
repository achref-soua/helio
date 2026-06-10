import { describe, expect, it, vi } from 'vitest';

import { createJourneyActivities } from '../src/journey-activities';
import { InMemorySmsProvider, type SmsProvider } from '../src/sms-provider';

const active = {
  status: 'ACTIVE',
  phone: '+15555551234',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: null,
  attributes: {},
};

function activitiesFor(contact: unknown, sms?: SmsProvider) {
  const prisma = { contact: { findUnique: vi.fn(async () => contact) } } as never;
  return createJourneyActivities(prisma, {} as never, {} as never, undefined, sms);
}

describe('sendJourneySms', () => {
  it('texts an active contact with a phone, personalizing the body', async () => {
    const sms = new InMemorySmsProvider();
    const result = await activitiesFor(active, sms).sendJourneySms('c1', 'Hi {{firstName}}');
    expect(result).toEqual({ sent: 1 });
    expect(sms.sent).toEqual([{ to: '+15555551234', body: 'Hi Ada' }]);
  });

  it('skips suppressed, phoneless, missing, or unconfigured sends', async () => {
    const sms = new InMemorySmsProvider();
    expect(
      (await activitiesFor({ ...active, status: 'UNSUBSCRIBED' }, sms).sendJourneySms('c', 'x'))
        .sent,
    ).toBe(0);
    expect(
      (await activitiesFor({ ...active, phone: null }, sms).sendJourneySms('c', 'x')).sent,
    ).toBe(0);
    expect((await activitiesFor(null, sms).sendJourneySms('c', 'x')).sent).toBe(0);
    // No SMS provider configured at all.
    expect((await activitiesFor(active, undefined).sendJourneySms('c', 'x')).sent).toBe(0);
    expect(sms.sent).toHaveLength(0);
  });
});
