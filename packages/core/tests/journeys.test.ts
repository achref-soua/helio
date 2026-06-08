import { describe, expect, it } from 'vitest';

import { journeyDefinitionSchema, journeyNodeById, nextNodeId } from '../src/journeys';

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
