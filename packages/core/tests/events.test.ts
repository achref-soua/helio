import { describe, expect, it } from 'vitest';

import { eventBatchSchema, trackedEventSchema } from '../src/events';

describe('trackedEventSchema', () => {
  it('accepts a minimal track event with anonymousId', () => {
    const result = trackedEventSchema.safeParse({
      type: 'track',
      event: 'Signed Up',
      anonymousId: 'anon-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts identify with userId and traits', () => {
    const result = trackedEventSchema.safeParse({
      type: 'identify',
      userId: 'user-42',
      traits: { plan: 'pro', seats: 3 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts page with name, properties, and context', () => {
    const result = trackedEventSchema.safeParse({
      type: 'page',
      name: 'Pricing',
      anonymousId: 'anon-1',
      properties: { experiment: 'b' },
      context: {
        page: { url: 'https://acme.test/pricing', title: 'Pricing' },
        library: { name: 'helio-js', version: '0.1.0' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects events with neither anonymousId nor userId', () => {
    for (const event of [
      { type: 'track', event: 'Orphan' },
      { type: 'identify', traits: {} },
      { type: 'page', name: 'Lost' },
    ]) {
      const result = trackedEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    }
  });

  it('rejects a track event without a name and unknown types', () => {
    expect(trackedEventSchema.safeParse({ type: 'track', anonymousId: 'a' }).success).toBe(false);
    expect(
      trackedEventSchema.safeParse({ type: 'track', event: '  ', anonymousId: 'a' }).success,
    ).toBe(false);
    expect(trackedEventSchema.safeParse({ type: 'screen', anonymousId: 'a' }).success).toBe(false);
  });

  it('rejects malformed timestamps', () => {
    const result = trackedEventSchema.safeParse({
      type: 'track',
      event: 'Clock Drift',
      anonymousId: 'a',
      timestamp: 'yesterday',
    });
    expect(result.success).toBe(false);
  });
});

describe('eventBatchSchema', () => {
  it('accepts a batch with sentAt and a body writeKey', () => {
    const result = eventBatchSchema.safeParse({
      batch: [{ type: 'track', event: 'Flushed', anonymousId: 'a' }],
      sentAt: new Date().toISOString(),
      writeKey: 'wk_demo',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty and oversized batches', () => {
    expect(eventBatchSchema.safeParse({ batch: [] }).success).toBe(false);
    const oversized = Array.from({ length: 501 }, (_, i) => ({
      type: 'track' as const,
      event: `e${i}`,
      anonymousId: 'a',
    }));
    expect(eventBatchSchema.safeParse({ batch: oversized }).success).toBe(false);
  });

  it('pinpoints the invalid event inside a batch', () => {
    const result = eventBatchSchema.safeParse({
      batch: [
        { type: 'track', event: 'Good', anonymousId: 'a' },
        { type: 'track', event: '' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === 'batch' && issue.path[1] === 1),
      ).toBe(true);
    }
  });
});
