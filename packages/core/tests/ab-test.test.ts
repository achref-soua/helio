import { describe, expect, it } from 'vitest';

import { abWinnerDecision, isInAbTestSample } from '../src/ab-test';

describe('abWinnerDecision', () => {
  it('calls a confident winner when one variant clearly beats the other', () => {
    // 1000 sends each; 30% vs 20% open — a large, real difference.
    const decision = abWinnerDecision({ sent: 1000, opens: 300 }, { sent: 1000, opens: 200 });
    expect(decision.winner).toBe('a');
    expect(decision.leader).toBe('a');
    expect(decision.confident).toBe(true);
    expect(decision.z).toBeGreaterThan(1.96);
  });

  it('picks b when b is the better, significant variant', () => {
    const decision = abWinnerDecision({ sent: 1000, opens: 180 }, { sent: 1000, opens: 320 });
    expect(decision.winner).toBe('b');
    expect(decision.z).toBeLessThan(-1.96);
  });

  it('stays inconclusive when the difference is within noise', () => {
    const decision = abWinnerDecision({ sent: 1000, opens: 250 }, { sent: 1000, opens: 255 });
    expect(decision.winner).toBeNull();
    expect(decision.confident).toBe(false);
    // The leader is still reported so the caller can promote it.
    expect(decision.leader).toBe('b');
  });

  it('refuses to call below the minimum sample, even on a big gap', () => {
    const decision = abWinnerDecision({ sent: 20, opens: 12 }, { sent: 20, opens: 3 });
    expect(decision.winner).toBeNull();
    expect(decision.leader).toBe('a');
  });

  it('breaks an exact tie toward the original (a) and stays inconclusive', () => {
    const decision = abWinnerDecision({ sent: 500, opens: 100 }, { sent: 500, opens: 100 });
    expect(decision.leader).toBe('a');
    expect(decision.winner).toBeNull();
  });

  it('handles zero sends without dividing by zero', () => {
    const decision = abWinnerDecision({ sent: 0, opens: 0 }, { sent: 0, opens: 0 });
    expect(decision.z).toBe(0);
    expect(decision.winner).toBeNull();
    expect(decision.rateA).toBe(0);
  });

  it('honours a custom confidence threshold', () => {
    const stats = [
      { sent: 800, opens: 250 },
      { sent: 800, opens: 220 },
    ] as const;
    // Borderline gap: significant at 90% but not 95%.
    expect(abWinnerDecision(stats[0], stats[1], { zThreshold: 1.96 }).winner).toBeNull();
    expect(abWinnerDecision(stats[0], stats[1], { zThreshold: 1.64 }).winner).toBe('a');
  });
});

describe('isInAbTestSample', () => {
  it('is deterministic for the same contact', () => {
    const id = 'contact_abc123';
    expect(isInAbTestSample(id, 20)).toBe(isInAbTestSample(id, 20));
  });

  it('covers nobody at 0% and everybody at 100%', () => {
    expect(isInAbTestSample('any', 0)).toBe(false);
    expect(isInAbTestSample('any', 100)).toBe(true);
  });

  it('splits roughly to the configured fraction across many ids', () => {
    let inSample = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      if (isInAbTestSample(`contact_${i}`, 20)) inSample += 1;
    }
    const fraction = inSample / n;
    // Hash spread should land near 20% (allow generous slack).
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.25);
  });
});
