import { describe, expect, it } from 'vitest';

import { countConditions, type SegmentRuleGroup, segmentRuleSchema } from '../src/segments';

const condition = (overrides: Record<string, unknown> = {}) => ({
  kind: 'condition' as const,
  target: 'field' as const,
  field: 'email' as const,
  operator: 'contains' as const,
  value: '@acme.com',
  ...overrides,
});

describe('segmentRuleSchema', () => {
  it('accepts a nested AND/OR tree across all condition targets', () => {
    const rule = {
      kind: 'group',
      op: 'and',
      children: [
        condition(),
        { kind: 'condition', target: 'status', operator: 'equals', value: 'ACTIVE' },
        {
          kind: 'group',
          op: 'or',
          children: [
            {
              kind: 'condition',
              target: 'attribute',
              key: 'plan',
              operator: 'equals',
              value: 'pro',
            },
            { kind: 'condition', target: 'attribute', key: 'plan', operator: 'is_set' },
            { kind: 'condition', target: 'created_at', operator: 'in_last_days', value: 30 },
            {
              kind: 'condition',
              target: 'created_at',
              operator: 'after',
              value: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ],
    };
    const result = segmentRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
  });

  it('rejects empty groups, unknown operators, and valueless valued operators', () => {
    expect(segmentRuleSchema.safeParse({ kind: 'group', op: 'and', children: [] }).success).toBe(
      false,
    );
    expect(
      segmentRuleSchema.safeParse({
        kind: 'group',
        op: 'and',
        children: [condition({ operator: 'matches_regex' })],
      }).success,
    ).toBe(false);
    expect(
      segmentRuleSchema.safeParse({
        kind: 'group',
        op: 'and',
        children: [condition({ value: undefined })],
      }).success,
    ).toBe(false);
  });

  it('rejects trees deeper than five levels', () => {
    let node: Record<string, unknown> = { kind: 'group', op: 'and', children: [condition()] };
    for (let i = 0; i < 5; i++) {
      node = { kind: 'group', op: 'and', children: [node] };
    }
    expect(segmentRuleSchema.safeParse(node).success).toBe(false);
  });

  it('rejects more than 50 conditions in total', () => {
    const children = Array.from({ length: 20 }, () => condition());
    const rule = {
      kind: 'group',
      op: 'or',
      children: [
        { kind: 'group', op: 'and', children },
        { kind: 'group', op: 'and', children },
        { kind: 'group', op: 'and', children: children.slice(0, 11) },
      ],
    };
    expect(countConditions(rule as unknown as SegmentRuleGroup)).toBe(51);
    expect(segmentRuleSchema.safeParse(rule).success).toBe(false);
  });

  it('rejects invalid created_at payloads', () => {
    expect(
      segmentRuleSchema.safeParse({
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'condition', target: 'created_at', operator: 'before', value: 'not-a-date' },
        ],
      }).success,
    ).toBe(false);
    expect(
      segmentRuleSchema.safeParse({
        kind: 'group',
        op: 'and',
        children: [{ kind: 'condition', target: 'created_at', operator: 'in_last_days', value: 0 }],
      }).success,
    ).toBe(false);
  });
});
