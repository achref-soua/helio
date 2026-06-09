import { describe, expect, it } from 'vitest';

import { aggregateAttribution, attributeCredit, attributionInputSchema } from '../src/attribution';

describe('attributionInputSchema', () => {
  it('requires a conversion event and defaults model/window', () => {
    const parsed = attributionInputSchema.parse({ workspaceId: 'ws', conversionEvent: 'Order' });
    expect(parsed.model).toBe('last');
    expect(parsed.windowDays).toBe(30);
    expect(
      attributionInputSchema.safeParse({ workspaceId: 'ws', conversionEvent: '' }).success,
    ).toBe(false);
    expect(
      attributionInputSchema.safeParse({
        workspaceId: 'ws',
        conversionEvent: 'Order',
        model: 'middle',
      }).success,
    ).toBe(false);
  });
});

describe('attributeCredit', () => {
  it('first-touch credits the earliest campaign', () => {
    expect([...attributeCredit(['a', 'b', 'c'], 'first')]).toEqual([['a', 1]]);
  });

  it('last-touch credits the latest campaign', () => {
    expect([...attributeCredit(['a', 'b', 'c'], 'last')]).toEqual([['c', 1]]);
  });

  it('linear shares equally across distinct campaigns', () => {
    const credit = attributeCredit(['a', 'b', 'a'], 'linear');
    expect(credit.get('a')).toBeCloseTo(0.5);
    expect(credit.get('b')).toBeCloseTo(0.5);
  });

  it('ignores empty touches and returns nothing without any', () => {
    expect([...attributeCredit(['', 'a', ''], 'last')]).toEqual([['a', 1]]);
    expect(attributeCredit(['', ''], 'first').size).toBe(0);
  });
});

describe('aggregateAttribution', () => {
  it('sums credit across conversions and ranks campaigns', () => {
    const rows = aggregateAttribution(
      [
        ['a', 'b'], // last → b
        ['c', 'b'], // last → b
        ['a'], // last → a
      ],
      'last',
    );
    expect(rows).toEqual([
      { campaignId: 'b', credit: 2 },
      { campaignId: 'a', credit: 1 },
    ]);
  });

  it('totals fractional linear credit', () => {
    const rows = aggregateAttribution(
      [
        ['a', 'b'], // 0.5 / 0.5
        ['a', 'c'], // 0.5 / 0.5
      ],
      'linear',
    );
    const byId = Object.fromEntries(rows.map((row) => [row.campaignId, row.credit]));
    expect(byId.a).toBeCloseTo(1);
    expect(byId.b).toBeCloseTo(0.5);
    expect(byId.c).toBeCloseTo(0.5);
    expect(rows[0]!.campaignId).toBe('a');
  });

  it('is empty when no conversion has a touch', () => {
    expect(aggregateAttribution([[], ['']], 'first')).toEqual([]);
  });
});
