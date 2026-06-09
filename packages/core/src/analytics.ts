import { z } from 'zod';

/**
 * Pure shaping logic for the behavioral-analytics reports. The ClickHouse
 * queries live in the web app (and degrade to "no data" without the full
 * stack); everything here is deterministic and unit-tested so the maths is
 * trustworthy regardless of the data plane.
 */

// ─── Funnels ────────────────────────────────────────────────────────────────

export const funnelInputSchema = z.object({
  workspaceId: z.string().min(1),
  /** Ordered event names; a person must hit them in this sequence. */
  steps: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
  /** Conversion window: the whole sequence must complete within this many days. */
  windowDays: z.number().int().min(1).max(90).default(30),
});
export type FunnelInput = z.infer<typeof funnelInputSchema>;

export interface FunnelStep {
  event: string;
  /** People who reached this step (having completed every earlier step). */
  reached: number;
  /** Share of the first step's people who reached here, in [0,1]. */
  rate: number;
  /** Share lost since the previous step, in [0,1]. */
  dropoff: number;
}

/**
 * ClickHouse `windowFunnel` returns, per person, the count of leading steps
 * they completed in order (their "level"). Fold that level histogram into the
 * number of people who reached each step: reaching step i needs level ≥ i.
 */
export function funnelStepCounts(
  levels: Array<{ level: number; people: number }>,
  stepCount: number,
): number[] {
  const reached = new Array<number>(stepCount).fill(0);
  for (const { level, people } of levels) {
    const capped = Math.min(level, stepCount);
    for (let i = 0; i < capped; i++) reached[i] = (reached[i] ?? 0) + people;
  }
  return reached;
}

/** Pair each step name with its reached count, conversion, and drop-off. */
export function funnelReport(steps: string[], reached: number[]): FunnelStep[] {
  const first = reached[0] ?? 0;
  return steps.map((event, index) => {
    const here = reached[index] ?? 0;
    const prev = index === 0 ? here : (reached[index - 1] ?? 0);
    return {
      event,
      reached: here,
      rate: first > 0 ? here / first : 0,
      dropoff: prev > 0 ? (prev - here) / prev : 0,
    };
  });
}

// ─── Cohort retention ────────────────────────────────────────────────────────

export const retentionInputSchema = z.object({
  workspaceId: z.string().min(1),
  /** How many weekly cohorts/periods to compute (also the lookback window). */
  weeks: z.number().int().min(2).max(26).default(8),
});
export type RetentionInput = z.infer<typeof retentionInputSchema>;

export interface CohortRow {
  /** Cohort label (the week a set of people were first seen, e.g. 2026-06-01). */
  cohort: string;
  /** People first seen in this cohort (period 0). */
  size: number;
  /** Retention fraction per week offset, in [0,1]; index 0 is always 1. */
  retention: number[];
}

/**
 * Shape `(cohort, period, people)` cells into a dense retention matrix: one
 * row per cohort, each holding the fraction of the cohort still active at
 * every week offset. Period 0 is the cohort size.
 */
export function retentionMatrix(
  cells: Array<{ cohort: string; period: number; people: number }>,
  periods: number,
): CohortRow[] {
  const byCohort = new Map<string, number[]>();
  for (const { cohort, period, people } of cells) {
    if (period < 0 || period >= periods) continue;
    const counts = byCohort.get(cohort) ?? new Array<number>(periods).fill(0);
    counts[period] = people;
    byCohort.set(cohort, counts);
  }
  return [...byCohort.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cohort, counts]) => {
      const size = counts[0] ?? 0;
      return { cohort, size, retention: counts.map((c) => (size > 0 ? c / size : 0)) };
    });
}
