/**
 * Autonomous A/B winner selection.
 *
 * A campaign can send both subject variants to a test slice of its
 * audience, wait, then send the better subject to everyone else. These
 * pure helpers decide (a) who is in the test slice and (b) whether one
 * variant beats the other with enough confidence to call it.
 */

export type AbVariant = 'a' | 'b';

export interface VariantStat {
  /** Emails actually sent for this variant. */
  sent: number;
  /** Unique contacts who opened (the success count). */
  opens: number;
}

export interface AbDecision {
  /** The confident winner, or null when the test is inconclusive. */
  winner: AbVariant | null;
  /** The higher open-rate variant regardless of confidence (ties → 'a'). */
  leader: AbVariant;
  /** True when the difference cleared the significance + sample bar. */
  confident: boolean;
  rateA: number;
  rateB: number;
  /** Two-proportion z statistic (0 when undefined). */
  z: number;
}

export interface AbDecisionOptions {
  /** Minimum sends per variant before a call may be made. */
  minPerVariant?: number;
  /** z threshold: 1.96 ≈ 95% confidence (two-sided), 1.64 ≈ 90%. */
  zThreshold?: number;
}

/**
 * Decide the winner from each variant's sent/opens via a two-proportion
 * z-test on the open rate. Returns a confident winner only when both
 * variants meet the minimum sample and |z| clears the threshold;
 * otherwise `winner` is null and the caller should promote `leader`.
 */
export function abWinnerDecision(
  a: VariantStat,
  b: VariantStat,
  options: AbDecisionOptions = {},
): AbDecision {
  const minPerVariant = options.minPerVariant ?? 100;
  const zThreshold = options.zThreshold ?? 1.96;

  const rateA = a.sent > 0 ? a.opens / a.sent : 0;
  const rateB = b.sent > 0 ? b.opens / b.sent : 0;
  // Ties resolve to 'a' (the original subject) — never flip without reason.
  const leader: AbVariant = rateB > rateA ? 'b' : 'a';

  const z = twoProportionZ(a, b);
  const enoughData = a.sent >= minPerVariant && b.sent >= minPerVariant;
  const confident = enoughData && Math.abs(z) >= zThreshold && rateA !== rateB;

  return { winner: confident ? leader : null, leader, confident, rateA, rateB, z };
}

function twoProportionZ(a: VariantStat, b: VariantStat): number {
  if (a.sent === 0 || b.sent === 0) return 0;
  const pA = a.opens / a.sent;
  const pB = b.opens / b.sent;
  const pooled = (a.opens + b.opens) / (a.sent + b.sent);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.sent + 1 / b.sent));
  if (se === 0) return 0;
  return (pA - pB) / se;
}

/**
 * Deterministic test-slice membership for a contact. Stable across
 * workflow replays and the test/promote passes — the same contact is
 * always on the same side of the split. `percent` is 0–100.
 */
export function isInAbTestSample(contactId: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return fnv1a(contactId) % 100 < percent;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in an unsigned 32-bit range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
