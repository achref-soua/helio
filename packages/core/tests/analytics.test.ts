import { describe, expect, it } from 'vitest';

import {
  funnelInputSchema,
  funnelReport,
  funnelStepCounts,
  retentionInputSchema,
  retentionMatrix,
} from '../src/analytics';

describe('funnelInputSchema', () => {
  it('requires 2–8 ordered steps and a sane window', () => {
    expect(
      funnelInputSchema.safeParse({ workspaceId: 'ws', steps: ['Viewed', 'Signed Up'] }).success,
    ).toBe(true);
    expect(funnelInputSchema.safeParse({ workspaceId: 'ws', steps: ['Only one'] }).success).toBe(
      false,
    );
    expect(
      funnelInputSchema.safeParse({
        workspaceId: 'ws',
        steps: ['a', 'b'],
        windowDays: 9999,
      }).success,
    ).toBe(false);
  });

  it('defaults the window to 30 days', () => {
    const parsed = funnelInputSchema.parse({ workspaceId: 'ws', steps: ['a', 'b'] });
    expect(parsed.windowDays).toBe(30);
  });
});

describe('funnelStepCounts', () => {
  it('folds a windowFunnel level histogram into per-step reach', () => {
    // 10 people reached level 0 (none), 30 reached step 1, 20 reached step 2,
    // 5 completed all 3.
    const reached = funnelStepCounts(
      [
        { level: 0, people: 10 },
        { level: 1, people: 30 },
        { level: 2, people: 20 },
        { level: 3, people: 5 },
      ],
      3,
    );
    // step1: 30+20+5, step2: 20+5, step3: 5
    expect(reached).toEqual([55, 25, 5]);
  });

  it('caps levels above the step count and ignores level 0', () => {
    expect(funnelStepCounts([{ level: 9, people: 4 }], 2)).toEqual([4, 4]);
    expect(funnelStepCounts([{ level: 0, people: 99 }], 2)).toEqual([0, 0]);
  });
});

describe('funnelReport', () => {
  it('computes conversion from the first step and per-step drop-off', () => {
    const report = funnelReport(['Viewed', 'Added', 'Bought'], [100, 40, 10]);
    expect(report[0]).toMatchObject({ event: 'Viewed', reached: 100, rate: 1, dropoff: 0 });
    expect(report[1]).toMatchObject({ event: 'Added', reached: 40, rate: 0.4 });
    expect(report[1]!.dropoff).toBeCloseTo(0.6);
    expect(report[2]).toMatchObject({ event: 'Bought', reached: 10, rate: 0.1 });
    expect(report[2]!.dropoff).toBeCloseTo(0.75);
  });

  it('stays finite when the funnel is empty', () => {
    const report = funnelReport(['a', 'b'], [0, 0]);
    expect(report.every((step) => step.rate === 0 && step.dropoff === 0)).toBe(true);
  });
});

describe('retentionInputSchema', () => {
  it('bounds the number of weeks and defaults to 8', () => {
    expect(retentionInputSchema.parse({ workspaceId: 'ws' }).weeks).toBe(8);
    expect(retentionInputSchema.safeParse({ workspaceId: 'ws', weeks: 1 }).success).toBe(false);
    expect(retentionInputSchema.safeParse({ workspaceId: 'ws', weeks: 99 }).success).toBe(false);
  });
});

describe('retentionMatrix', () => {
  it('builds a dense per-cohort retention grid sorted by cohort', () => {
    const rows = retentionMatrix(
      [
        { cohort: '2026-06-08', period: 0, people: 100 },
        { cohort: '2026-06-08', period: 1, people: 60 },
        { cohort: '2026-06-08', period: 2, people: 30 },
        { cohort: '2026-06-01', period: 0, people: 50 },
        { cohort: '2026-06-01', period: 1, people: 25 },
      ],
      3,
    );
    expect(rows.map((row) => row.cohort)).toEqual(['2026-06-01', '2026-06-08']);
    const recent = rows[1]!;
    expect(recent.size).toBe(100);
    expect(recent.retention).toEqual([1, 0.6, 0.3]);
    const older = rows[0]!;
    expect(older.retention).toEqual([1, 0.5, 0]);
  });

  it('drops out-of-range periods and handles empty cohorts', () => {
    const rows = retentionMatrix(
      [
        { cohort: 'c', period: 0, people: 0 },
        { cohort: 'c', period: 5, people: 9 },
      ],
      3,
    );
    expect(rows[0]!.size).toBe(0);
    expect(rows[0]!.retention).toEqual([0, 0, 0]);
  });
});
