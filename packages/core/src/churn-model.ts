import { z } from 'zod';

/**
 * The bring-your-own churn model contract (ADR-0021). `CHURN_FEATURE_NAMES`
 * mirrors the intelligence service's `FEATURE_NAMES` exactly — both sides
 * assert the list in their own tests, so a rename breaks loudly instead of
 * silently feeding a model garbage columns.
 */

export const CHURN_FEATURE_NAMES = [
  'total_events',
  'distinct_events',
  'events_7d',
  'events_30d',
  'opens',
  'clicks',
  'pageviews',
  'recency_days',
  'tenure_days',
  'rule_score',
] as const;
export type ChurnFeatureName = (typeof CHURN_FEATURE_NAMES)[number];

export const CHURN_MODEL_FORMATS = ['ONNX', 'XGBOOST_JSON', 'HTTP'] as const;
export type ChurnModelFormat = (typeof CHURN_MODEL_FORMATS)[number];

/**
 * How Helio's features map onto the model's inputs: an ordered subset of
 * the feature names (the model receives exactly these columns, in this
 * order) plus where the churn probability lives in the output —
 * `(n,)` outputs ignore positiveIndex; `(n,2)` outputs pick the column.
 */
export const churnFeatureMappingSchema = z.object({
  inputs: z
    .array(z.enum(CHURN_FEATURE_NAMES))
    .min(1)
    .max(CHURN_FEATURE_NAMES.length)
    .refine((inputs) => new Set(inputs).size === inputs.length, {
      message: 'inputs must not repeat',
    }),
  output: z
    .object({
      kind: z.literal('probability').default('probability'),
      positiveIndex: z.number().int().min(0).max(1).default(1),
    })
    .default({ kind: 'probability', positiveIndex: 1 }),
});
export type ChurnFeatureMapping = z.infer<typeof churnFeatureMappingSchema>;

/** The default mapping: every feature, in canonical order. */
export function defaultChurnFeatureMapping(): ChurnFeatureMapping {
  return {
    inputs: [...CHURN_FEATURE_NAMES],
    output: { kind: 'probability', positiveIndex: 1 },
  };
}

/** Allowed upload extensions per format (pickle is rejected by design). */
export const CHURN_UPLOAD_EXTENSIONS: Record<Exclude<ChurnModelFormat, 'HTTP'>, string> = {
  ONNX: '.onnx',
  XGBOOST_JSON: '.json',
};
