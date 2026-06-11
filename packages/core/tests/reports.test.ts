import { describe, expect, it } from 'vitest';

import { countByDay, dayKey, dayKeys, fillDailySeries, mergeDailySeries } from '../src/reports';

describe('report series helpers', () => {
  const now = new Date('2026-06-11T15:30:00Z');

  it('builds ascending day keys ending today', () => {
    const keys = dayKeys(3, now);
    expect(keys).toEqual(['2026-06-09', '2026-06-10', '2026-06-11']);
  });

  it('keys are UTC days regardless of time of day', () => {
    expect(dayKey(new Date('2026-06-11T23:59:59Z'))).toBe('2026-06-11');
    expect(dayKey(new Date('2026-06-11T00:00:00Z'))).toBe('2026-06-11');
  });

  it('fills gaps with zeros, in order', () => {
    const counts = countByDay([
      new Date('2026-06-09T10:00:00Z'),
      new Date('2026-06-09T11:00:00Z'),
      new Date('2026-06-11T01:00:00Z'),
    ]);
    expect(fillDailySeries(dayKeys(3, now), counts)).toEqual([
      { day: '2026-06-09', count: 2 },
      { day: '2026-06-10', count: 0 },
      { day: '2026-06-11', count: 1 },
    ]);
  });

  it('merges named series into chart rows', () => {
    const email = countByDay([new Date('2026-06-10T08:00:00Z')]);
    const inApp = countByDay([new Date('2026-06-11T08:00:00Z')]);
    expect(mergeDailySeries(dayKeys(2, now), { email, inApp })).toEqual([
      { day: '2026-06-10', email: 1, inApp: 0 },
      { day: '2026-06-11', email: 0, inApp: 1 },
    ]);
  });
});
