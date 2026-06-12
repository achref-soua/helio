import { describe, expect, it } from 'vitest';

import {
  CHURN_FEATURE_NAMES,
  churnFeatureMappingSchema,
  defaultChurnFeatureMapping,
} from '../src/churn-model';

describe('churn model contract', () => {
  it('pins the feature list both runtimes assert against', () => {
    // apps/intelligence/tests/test_model_runtime.py asserts the same
    // literal against its FEATURE_NAMES — change both together.
    expect([...CHURN_FEATURE_NAMES]).toEqual([
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
    ]);
  });

  it('accepts ordered subsets and rejects unknown or repeated inputs', () => {
    expect(
      churnFeatureMappingSchema.parse({ inputs: ['tenure_days', 'opens'] }).output.positiveIndex,
    ).toBe(1);
    expect(() => churnFeatureMappingSchema.parse({ inputs: ['made_up'] })).toThrowError();
    expect(() => churnFeatureMappingSchema.parse({ inputs: ['opens', 'opens'] })).toThrowError(
      /repeat/,
    );
    expect(defaultChurnFeatureMapping().inputs).toHaveLength(CHURN_FEATURE_NAMES.length);
  });
});
