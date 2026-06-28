import { describe, expect, it, vi } from 'vitest';

import { createJourneyActivities } from '../src/journey-activities';
import { InMemoryWhatsAppProvider, type WhatsAppProvider } from '../src/whatsapp-provider';

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

function activitiesFor(contact: unknown, whatsapp?: WhatsAppProvider) {
  const prisma = {
    contact: { findUnique: vi.fn(async () => contact) },
    journeyDelivery: {
      upsert: vi.fn(async () => ({ status: 'PENDING' })),
      update: vi.fn(async () => ({})),
    },
  } as never;
  return createJourneyActivities(
    prisma,
    {} as never,
    {} as never,
    undefined,
    undefined,
    async () => whatsapp,
  );
}

describe('sendJourneyWhatsApp', () => {
  it('messages an active contact with a phone, personalizing the body', async () => {
    const whatsapp = new InMemoryWhatsAppProvider();
    const result = await activitiesFor(active, whatsapp).sendJourneyWhatsApp(
      'c1',
      'Hi {{firstName}}',
      'run1',
      'node1',
    );
    expect(result).toEqual({ sent: 1 });
    expect(whatsapp.sent).toEqual([{ to: '+15555551234', body: 'Hi Ada' }]);
  });

  it('skips suppressed, phoneless, missing, or unconfigured sends', async () => {
    const whatsapp = new InMemoryWhatsAppProvider();
    expect(
      (
        await activitiesFor({ ...active, status: 'BOUNCED' }, whatsapp).sendJourneyWhatsApp(
          'c',
          'x',
          'run1',
          'node1',
        )
      ).sent,
    ).toBe(0);
    expect(
      (
        await activitiesFor({ ...active, phone: null }, whatsapp).sendJourneyWhatsApp(
          'c',
          'x',
          'run1',
          'node1',
        )
      ).sent,
    ).toBe(0);
    expect(
      (await activitiesFor(null, whatsapp).sendJourneyWhatsApp('c', 'x', 'run1', 'node1')).sent,
    ).toBe(0);
    expect(
      (await activitiesFor(active, undefined).sendJourneyWhatsApp('c', 'x', 'run1', 'node1')).sent,
    ).toBe(0);
    expect(whatsapp.sent).toHaveLength(0);
  });
});
