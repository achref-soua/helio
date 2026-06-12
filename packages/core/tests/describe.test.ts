import { describe, expect, it } from 'vitest';

import { describeSegmentRule, summarizeJourney } from '../src/describe';
import type { JourneyDefinition } from '../src/journeys';
import type { SegmentRule } from '../src/segments';

describe('describeSegmentRule', () => {
  it('reads a nested rule as one sentence', () => {
    const rule = {
      kind: 'group',
      op: 'and',
      children: [
        { kind: 'condition', target: 'attribute', key: 'plan', operator: 'equals', value: 'pro' },
        {
          kind: 'group',
          op: 'or',
          children: [
            { kind: 'condition', target: 'score', operator: 'gte', value: 70 },
            {
              kind: 'condition',
              target: 'prediction',
              metric: 'churnRisk',
              operator: 'gte',
              value: 0.6,
            },
          ],
        },
      ],
    } as SegmentRule;
    expect(describeSegmentRule(rule)).toBe(
      'plan is “pro” and (lead score ≥ 70 or churn risk ≥ 60%)',
    );
  });

  it('covers field, status, created_at, and event conditions', () => {
    const rule = {
      kind: 'group',
      op: 'and',
      children: [
        {
          kind: 'condition',
          target: 'field',
          field: 'email',
          operator: 'ends_with',
          value: '@acme.io',
        },
        { kind: 'condition', target: 'status', operator: 'equals', value: 'ACTIVE' },
        { kind: 'condition', target: 'created_at', operator: 'in_last_days', value: 30 },
        {
          kind: 'condition',
          target: 'event',
          event: 'Pricing Viewed',
          operator: 'at_least',
          count: 2,
          inLastDays: 14,
        },
      ],
    } as SegmentRule;
    expect(describeSegmentRule(rule)).toBe(
      'email ends with “@acme.io” and status is active and joined in the last 30 days and did “Pricing Viewed” at least 2× in the last 14 days',
    );
  });
});

describe('summarizeJourney', () => {
  it('flattens a branching journey breadth-first with edge labels', () => {
    const definition = {
      trigger: { type: 'event', event: 'Signed Up' },
      startNodeId: 'a',
      nodes: [
        { id: 'a', type: 'send_email', templateId: 'tpl_1' },
        { id: 'w', type: 'wait', seconds: 172800 },
        {
          id: 'b',
          type: 'branch',
          condition: {
            kind: 'condition',
            target: 'attribute',
            key: 'plan',
            operator: 'equals',
            value: 'pro',
          },
        },
        { id: 'y', type: 'update_trait', key: 'journey', value: 'welcomed' },
        { id: 'n', type: 'send_sms', body: 'hi' },
        { id: 'e', type: 'end' },
      ],
      edges: [
        { from: 'a', to: 'w' },
        { from: 'w', to: 'b' },
        { from: 'b', to: 'y', label: 'yes' },
        { from: 'b', to: 'n', label: 'no' },
        { from: 'y', to: 'e' },
        { from: 'n', to: 'e' },
      ],
    } as JourneyDefinition;
    const steps = summarizeJourney(definition);
    expect(steps.map((step) => step.summary)).toEqual([
      'Send email',
      'Wait 2 days',
      'If plan is “pro”',
      'Set journey = “welcomed”',
      'Send SMS',
      'End',
    ]);
    expect(steps[3]?.via).toBe('yes');
    expect(steps[4]?.via).toBe('no');
  });

  it('never loops on a cyclic definition', () => {
    const definition = {
      trigger: { type: 'event', event: 'X' },
      startNodeId: 'a',
      nodes: [
        { id: 'a', type: 'wait', seconds: 60 },
        { id: 'b', type: 'wait', seconds: 60 },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    } as JourneyDefinition;
    expect(summarizeJourney(definition)).toHaveLength(2);
  });
});
