import { describe, expect, it } from 'vitest';

import {
  endpointsForEvent,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_EVENTS,
  webhookEventSchema,
} from '../src/webhooks';

describe('generateWebhookSecret', () => {
  it('mints a unique whsec_-prefixed secret', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe('signWebhookPayload / verifyWebhookSignature', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'deal.won' });

  it('round-trips a signature within the freshness window', async () => {
    const now = 1_800_000_000;
    const header = await signWebhookPayload(secret, body, now);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhookSignature(secret, body, header, 300, now)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const now = 1_800_000_000;
    const header = await signWebhookPayload(secret, body, now);
    expect(await verifyWebhookSignature(secret, `${body} `, header, 300, now)).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    const now = 1_800_000_000;
    const header = await signWebhookPayload(secret, body, now);
    expect(await verifyWebhookSignature('whsec_other', body, header, 300, now)).toBe(false);
  });

  it('rejects a stale timestamp outside the tolerance', async () => {
    const signedAt = 1_800_000_000;
    const header = await signWebhookPayload(secret, body, signedAt);
    // 10 minutes later, with a 5-minute tolerance.
    expect(await verifyWebhookSignature(secret, body, header, 300, signedAt + 600)).toBe(false);
  });

  it('rejects a malformed header', async () => {
    expect(await verifyWebhookSignature(secret, body, 'not-a-signature')).toBe(false);
    expect(await verifyWebhookSignature(secret, body, 't=abc,v1=zz')).toBe(false);
  });
});

describe('endpointsForEvent', () => {
  const endpoints = [
    { id: 'a', enabled: true, events: ['deal.won', 'deal.lost'] },
    { id: 'b', enabled: true, events: ['contact.created'] },
    { id: 'c', enabled: false, events: ['deal.won'] },
  ];

  it('returns enabled endpoints subscribed to the event', () => {
    expect(endpointsForEvent(endpoints, 'deal.won').map((e) => e.id)).toEqual(['a']);
    expect(endpointsForEvent(endpoints, 'contact.created').map((e) => e.id)).toEqual(['b']);
    expect(endpointsForEvent(endpoints, 'task.completed')).toEqual([]);
  });
});

describe('webhookEventSchema', () => {
  it('accepts the catalog and rejects unknown events', () => {
    for (const event of WEBHOOK_EVENTS) expect(webhookEventSchema.parse(event)).toBe(event);
    expect(webhookEventSchema.safeParse('deal.exploded').success).toBe(false);
  });
});
