import { describe, expect, it } from 'vitest';

import {
  journeyDefinitionSchema,
  journeyNodeById,
  nextNodeId,
  quietHoursDelayMs,
  sendTimeDelayMs,
} from '../src/journeys';

const valid = {
  trigger: { type: 'event', event: 'Signed Up' },
  startNodeId: 'n1',
  nodes: [
    { id: 'n1', type: 'send_email', templateId: 'tpl_1', position: { x: 0, y: 0 } },
    { id: 'n2', type: 'wait', seconds: 3600 },
    {
      id: 'n3',
      type: 'branch',
      condition: {
        kind: 'condition',
        target: 'attribute',
        key: 'plan',
        operator: 'equals',
        value: 'pro',
      },
    },
    { id: 'n4', type: 'send_email', templateId: 'tpl_2' },
    { id: 'n5', type: 'end' },
  ],
  edges: [
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n3' },
    { from: 'n3', to: 'n4', label: 'yes' },
    { from: 'n3', to: 'n5', label: 'no' },
    { from: 'n4', to: 'n5' },
  ],
} as const;

describe('journeyDefinitionSchema', () => {
  it('accepts a trigger → send → wait → branch graph', () => {
    expect(journeyDefinitionSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a send_sms node and rejects an empty body', () => {
    const withSms = {
      trigger: { type: 'event', event: 'Signed Up' },
      startNodeId: 's1',
      nodes: [
        { id: 's1', type: 'send_sms', body: 'Hi {{firstName}}' },
        { id: 's2', type: 'end' },
      ],
      edges: [{ from: 's1', to: 's2' }],
    };
    expect(journeyDefinitionSchema.safeParse(withSms).success).toBe(true);
    expect(
      journeyDefinitionSchema.safeParse({
        ...withSms,
        nodes: [{ id: 's1', type: 'send_sms', body: '' }, withSms.nodes[1]],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown start nodes, dangling edges, and duplicate ids', () => {
    expect(journeyDefinitionSchema.safeParse({ ...valid, startNodeId: 'ghost' }).success).toBe(
      false,
    );
    expect(
      journeyDefinitionSchema.safeParse({
        ...valid,
        edges: [...valid.edges, { from: 'n5', to: 'ghost' }],
      }).success,
    ).toBe(false);
    expect(
      journeyDefinitionSchema.safeParse({
        ...valid,
        nodes: [...valid.nodes, { id: 'n1', type: 'end' }],
      }).success,
    ).toBe(false);
  });

  it('enforces branch yes/no edges and single-exit nodes', () => {
    const missingNo = {
      ...valid,
      edges: valid.edges.filter((edge) => !('label' in edge) || edge.label !== 'no'),
    };
    expect(journeyDefinitionSchema.safeParse(missingNo).success).toBe(false);

    const doubleExit = {
      ...valid,
      edges: [...valid.edges, { from: 'n1', to: 'n5' }],
    };
    expect(journeyDefinitionSchema.safeParse(doubleExit).success).toBe(false);

    const endWithExit = {
      ...valid,
      edges: [...valid.edges, { from: 'n5', to: 'n1' }],
    };
    expect(journeyDefinitionSchema.safeParse(endWithExit).success).toBe(false);
  });

  it('rejects cycles', () => {
    const cyclic = {
      trigger: { type: 'event', event: 'Loop' },
      startNodeId: 'a',
      nodes: [
        { id: 'a', type: 'wait', seconds: 60 },
        { id: 'b', type: 'wait', seconds: 60 },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    const result = journeyDefinitionSchema.safeParse(cyclic);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('cycles'))).toBe(true);
    }
  });

  it('rejects out-of-range waits', () => {
    expect(
      journeyDefinitionSchema.safeParse({
        ...valid,
        nodes: valid.nodes.map((node) => (node.id === 'n2' ? { ...node, seconds: 5 } : node)),
      }).success,
    ).toBe(false);
  });
});

describe('graph helpers', () => {
  it('walks edges with and without labels', () => {
    const definition = journeyDefinitionSchema.parse(valid);
    expect(nextNodeId(definition, 'n1')).toBe('n2');
    expect(nextNodeId(definition, 'n3', 'yes')).toBe('n4');
    expect(nextNodeId(definition, 'n3', 'no')).toBe('n5');
    expect(nextNodeId(definition, 'n5')).toBeNull();
    expect(journeyNodeById(definition, 'n2')?.type).toBe('wait');
    expect(journeyNodeById(definition, 'ghost')).toBeNull();
  });
});

describe('journey schema v2', () => {
  const base = {
    trigger: { type: 'event', event: 'Signed Up' },
    startNodeId: 's',
    nodes: [
      { id: 's', type: 'ab_split', ratioA: 50 },
      { id: 'ta', type: 'update_trait', key: 'variant', value: 'a' },
      { id: 'tb', type: 'webhook', url: 'https://hooks.example.com/x' },
      { id: 'e', type: 'end' },
    ],
    edges: [
      { from: 's', to: 'ta', label: 'a' },
      { from: 's', to: 'tb', label: 'b' },
      { from: 'ta', to: 'e' },
      { from: 'tb', to: 'e' },
    ],
  };

  it('accepts ab_split, update_trait, and webhook nodes', () => {
    expect(journeyDefinitionSchema.safeParse(base).success).toBe(true);
  });

  it('requires a and b edges on ab_split', () => {
    const missing = { ...base, edges: base.edges.filter((edge) => edge.label !== 'b') };
    const result = journeyDefinitionSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it('accepts quiet hours and frequency caps; rejects bad shapes', () => {
    expect(
      journeyDefinitionSchema.safeParse({
        ...base,
        quietHours: { start: '21:00', end: '08:00', timezone: 'Europe/Paris' },
        frequencyCap: { maxEmails: 3, perDays: 7 },
      }).success,
    ).toBe(true);
    expect(
      journeyDefinitionSchema.safeParse({ ...base, quietHours: { start: '25:00', end: '08:00' } })
        .success,
    ).toBe(false);
    expect(
      journeyDefinitionSchema.safeParse({ ...base, frequencyCap: { maxEmails: 0, perDays: 7 } })
        .success,
    ).toBe(false);
  });
});

describe('quietHoursDelayMs', () => {
  it('returns 0 outside the window', () => {
    expect(
      quietHoursDelayMs(
        { start: '21:00', end: '08:00', timezone: 'UTC' },
        new Date('2026-06-08T12:00:00Z'),
      ),
    ).toBe(0);
  });

  it('defers to the end of a same-day window', () => {
    expect(
      quietHoursDelayMs(
        { start: '09:00', end: '17:00', timezone: 'UTC' },
        new Date('2026-06-08T16:30:00Z'),
      ),
    ).toBe(30 * 60_000);
  });

  it('handles windows wrapping past midnight on both sides', () => {
    const quiet = { start: '21:00', end: '08:00', timezone: 'UTC' };
    expect(quietHoursDelayMs(quiet, new Date('2026-06-08T23:00:00Z'))).toBe(9 * 60 * 60_000);
    expect(quietHoursDelayMs(quiet, new Date('2026-06-08T06:00:00Z'))).toBe(2 * 60 * 60_000);
  });

  it('respects the configured timezone', () => {
    // 12:00 UTC = 21:00 in Tokyo — inside a 21:00–08:00 Tokyo window.
    expect(
      quietHoursDelayMs(
        { start: '21:00', end: '08:00', timezone: 'Asia/Tokyo' },
        new Date('2026-06-08T12:00:00Z'),
      ),
    ).toBe(11 * 60 * 60_000);
  });
});

describe('sendTimeDelayMs', () => {
  it('returns 0 when already inside the best hour', () => {
    expect(sendTimeDelayMs(14, new Date('2026-06-08T14:30:00Z'))).toBe(0);
  });

  it('defers to the best hour later today', () => {
    expect(sendTimeDelayMs(20, new Date('2026-06-08T14:00:00Z'))).toBe(6 * 60 * 60_000);
  });

  it('wraps to tomorrow when the best hour already passed', () => {
    // best hour 9, now 14:00 -> 19h until 09:00 next day.
    expect(sendTimeDelayMs(9, new Date('2026-06-08T14:00:00Z'))).toBe(19 * 60 * 60_000);
  });

  it('respects the timezone', () => {
    // 00:00 UTC = 09:00 Tokyo; best hour 9 Tokyo -> send now.
    expect(sendTimeDelayMs(9, new Date('2026-06-08T00:00:00Z'), 'Asia/Tokyo')).toBe(0);
  });

  it('ignores an out-of-range hour (no deferral)', () => {
    expect(sendTimeDelayMs(99, new Date('2026-06-08T14:00:00Z'))).toBe(0);
  });
});
