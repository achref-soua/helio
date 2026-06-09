import { z } from 'zod';

/**
 * Multi-touch attribution: distribute credit for a conversion across the
 * campaign touchpoints that preceded it. The ClickHouse query assembles each
 * converter's ordered touches; the credit maths lives here, pure and tested.
 */

export const ATTRIBUTION_MODELS = ['first', 'last', 'linear'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export const attributionInputSchema = z.object({
  workspaceId: z.string().min(1),
  /** The event that counts as a conversion (e.g. "Order Completed"). */
  conversionEvent: z.string().trim().min(1).max(120),
  /** Look-back window for both the conversion and its preceding touches. */
  windowDays: z.number().int().min(1).max(90).default(30),
  model: z.enum(ATTRIBUTION_MODELS).default('last'),
});
export type AttributionInput = z.infer<typeof attributionInputSchema>;

export interface AttributionRow {
  campaignId: string;
  /** Fractional conversions credited to this campaign. */
  credit: number;
}

/**
 * Split one conversion's credit (1.0) across its ordered campaign touches:
 * first-touch gives it all to the earliest, last-touch to the latest, and
 * linear shares it equally across the distinct campaigns involved.
 */
export function attributeCredit(campaigns: string[], model: AttributionModel): Map<string, number> {
  const credit = new Map<string, number>();
  const touches = campaigns.filter((campaign) => campaign.length > 0);
  if (touches.length === 0) return credit;

  const add = (campaign: string, value: number) =>
    credit.set(campaign, (credit.get(campaign) ?? 0) + value);

  if (model === 'first') {
    add(touches[0]!, 1);
  } else if (model === 'last') {
    add(touches[touches.length - 1]!, 1);
  } else {
    const unique = [...new Set(touches)];
    const share = 1 / unique.length;
    for (const campaign of unique) add(campaign, share);
  }
  return credit;
}

/**
 * Sum credit across every conversion's touch list into per-campaign totals,
 * ranked by credit. Each `conversions[i]` is one converter's ordered touches.
 */
export function aggregateAttribution(
  conversions: string[][],
  model: AttributionModel,
): AttributionRow[] {
  const totals = new Map<string, number>();
  for (const campaigns of conversions) {
    for (const [campaign, value] of attributeCredit(campaigns, model)) {
      totals.set(campaign, (totals.get(campaign) ?? 0) + value);
    }
  }
  return [...totals.entries()]
    .map(([campaignId, credit]) => ({ campaignId, credit }))
    .sort((a, b) => b.credit - a.credit);
}
