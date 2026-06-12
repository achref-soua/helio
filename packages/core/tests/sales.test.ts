import { describe, expect, it } from 'vitest';

import {
  avgCycleDays,
  ownerLeaderboard,
  pipelineValueByStage,
  type SalesDeal,
  weightedForecastCents,
  winRate,
} from '../src/sales';

function deal(partial: Partial<SalesDeal>): SalesDeal {
  return {
    valueCents: 100_00,
    status: 'OPEN',
    stageName: 'Lead',
    ownerId: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    closedAt: null,
    ...partial,
  };
}

describe('sales report math', () => {
  it('sums open pipeline value per stage, ignoring closed deals', () => {
    const rows = pipelineValueByStage([
      deal({ stageName: 'Lead', valueCents: 100_00 }),
      deal({ stageName: 'Lead', valueCents: 50_00 }),
      deal({ stageName: 'Proposal', valueCents: 200_00 }),
      deal({ status: 'WON', stageName: 'Won', valueCents: 999_00 }),
    ]);
    expect(rows).toEqual([
      { stage: 'Lead', count: 2, valueCents: 150_00 },
      { stage: 'Proposal', count: 1, valueCents: 200_00 },
    ]);
  });

  it('win rate is won over closed, null before any close', () => {
    expect(winRate([deal({})])).toBeNull();
    expect(
      winRate([deal({ status: 'WON' }), deal({ status: 'LOST' }), deal({ status: 'LOST' })]),
    ).toBeCloseTo(1 / 3);
  });

  it('average cycle uses closed deals with a close date', () => {
    expect(avgCycleDays([deal({})])).toBeNull();
    const days = avgCycleDays([
      deal({
        status: 'WON',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        closedAt: new Date('2026-06-11T00:00:00Z'),
      }),
      deal({
        status: 'LOST',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        closedAt: new Date('2026-06-05T00:00:00Z'),
      }),
    ]);
    expect(days).toBeCloseTo(7);
  });

  it('forecast weights open value by the win rate to date', () => {
    expect(weightedForecastCents([deal({})])).toBeNull();
    const cents = weightedForecastCents([
      deal({ status: 'WON' }),
      deal({ status: 'LOST' }),
      deal({ valueCents: 1000_00 }),
    ]);
    expect(cents).toBe(500_00);
  });

  it('leaderboard ranks owners by won value, unassigned grouped', () => {
    const rows = ownerLeaderboard([
      deal({ status: 'WON', ownerId: 'u1', valueCents: 100_00 }),
      deal({ status: 'WON', ownerId: 'u2', valueCents: 300_00 }),
      deal({ status: 'WON', ownerId: 'u2', valueCents: 50_00 }),
      deal({ status: 'WON', ownerId: null, valueCents: 10_00 }),
      deal({ status: 'LOST', ownerId: 'u1', valueCents: 999_00 }),
    ]);
    expect(rows.map((row) => row.ownerId)).toEqual(['u2', 'u1', null]);
    expect(rows[0]).toEqual({ ownerId: 'u2', wonCents: 350_00, wonCount: 2 });
  });
});
