import { describe, expect, it } from 'vitest';

import {
  buildEventConditionQuery,
  countConditions,
  extractEventConditions,
  type SegmentRuleGroup,
  segmentRuleSchema,
} from '../src/segments';

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

describe('behavioral (event) conditions', () => {
  const condition = {
    kind: 'condition',
    target: 'event',
    event: 'Signed Up',
    operator: 'at_least',
    count: 2,
    inLastDays: 30,
  } as const;

  it('accepts event conditions inside rules and rejects bad shapes', () => {
    expect(
      segmentRuleSchema.safeParse({ kind: 'group', op: 'and', children: [condition] }).success,
    ).toBe(true);
    expect(
      segmentRuleSchema.safeParse({
        kind: 'group',
        op: 'and',
        children: [{ ...condition, operator: 'sometimes' }],
      }).success,
    ).toBe(false);
    expect(
      segmentRuleSchema.safeParse({
        kind: 'group',
        op: 'and',
        children: [{ ...condition, inLastDays: 0 }],
      }).success,
    ).toBe(false);
  });

  it('extracts and dedupes event conditions across nesting', () => {
    const rule = segmentRuleSchema.parse({
      kind: 'group',
      op: 'or',
      children: [
        condition,
        { kind: 'group', op: 'and', children: [condition, { ...condition, event: 'Paid' }] },
        { kind: 'condition', target: 'status', operator: 'equals', value: 'ACTIVE' },
      ],
    });
    const extracted = extractEventConditions(rule);
    expect(extracted).toHaveLength(2);
    expect(new Set(extracted.map((c) => c.event))).toEqual(new Set(['Signed Up', 'Paid']));
  });

  it('builds CH queries with the right HAVING and set mode per operator', () => {
    const atLeast = buildEventConditionQuery({ ...condition });
    expect(atLeast.mode).toBe('in');
    expect(atLeast.query).toContain('count() >= {count:UInt32}');
    expect(atLeast.params).toEqual({ event: 'Signed Up', days: 30, count: 2 });

    const atMost = buildEventConditionQuery({ ...condition, operator: 'at_most' });
    expect(atMost.mode).toBe('notIn');
    expect(atMost.query).toContain('count() > {count:UInt32}');

    const never = buildEventConditionQuery({ ...condition, operator: 'never' });
    expect(never.mode).toBe('notIn');
    expect(never.params.count).toBe(1);
    expect(never.query).toContain('count() >= 1');
  });
});
