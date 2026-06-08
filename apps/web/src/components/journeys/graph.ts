import type { JourneyDefinition, JourneyNode } from '@helio/core';
import { journeyDefinitionSchema } from '@helio/core';
import type { Edge, Node } from '@xyflow/react';

/**
 * Canvas ↔ definition conversion. The trigger is a pseudo-node on the
 * canvas (`TRIGGER_ID`); its single outgoing edge marks startNodeId.
 */

export const TRIGGER_ID = '__trigger__';

export interface TriggerData {
  event: string;
  [key: string]: unknown;
}
export interface SendEmailData {
  templateId: string;
  [key: string]: unknown;
}
export interface WaitData {
  /** Kept as string for the input field; parsed on save. */
  hours: string;
  [key: string]: unknown;
}
export interface BranchData {
  attributeKey: string;
  operator: 'equals' | 'not_equals';
  value: string;
  [key: string]: unknown;
}

export type CanvasNode = Node;

let nodeCounter = 0;
export const nextCanvasId = (type: string) => `${type}-${Date.now().toString(36)}-${++nodeCounter}`;

export function definitionToCanvas(definition: JourneyDefinition): {
  nodes: CanvasNode[];
  edges: Edge[];
} {
  const nodes: CanvasNode[] = [
    {
      id: TRIGGER_ID,
      type: 'trigger',
      position: { x: 40, y: 40 },
      data: { event: definition.trigger.event },
      deletable: false,
    },
  ];
  definition.nodes.forEach((node, index) => {
    const position = node.position ?? { x: 40, y: 180 + index * 140 };
    if (node.type === 'send_email') {
      nodes.push({
        id: node.id,
        type: 'send_email',
        position,
        data: { templateId: node.templateId },
      });
    } else if (node.type === 'wait') {
      nodes.push({
        id: node.id,
        type: 'wait',
        position,
        data: { hours: String(node.seconds / 3600) },
      });
    } else if (node.type === 'branch') {
      const condition = node.condition as { key?: string; operator?: string; value?: string };
      nodes.push({
        id: node.id,
        type: 'branch',
        position,
        data: {
          attributeKey: condition.key ?? '',
          operator: (condition.operator as BranchData['operator']) ?? 'equals',
          value: condition.value ?? '',
        },
      });
    } else {
      nodes.push({ id: node.id, type: 'end', position, data: {} });
    }
  });

  const edges: Edge[] = [
    { id: 'e-trigger', source: TRIGGER_ID, target: definition.startNodeId },
    ...definition.edges.map((edge, index) => ({
      id: `e-${index}-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: edge.label,
      label: edge.label,
    })),
  ];
  return { nodes, edges };
}

export interface CanvasConversion {
  definition?: JourneyDefinition;
  issues: string[];
}

export function canvasToDefinition(nodes: CanvasNode[], edges: Edge[]): CanvasConversion {
  const issues: string[] = [];
  const trigger = nodes.find((node) => node.id === TRIGGER_ID);
  const triggerEvent = String((trigger?.data as TriggerData | undefined)?.event ?? '').trim();
  if (!triggerEvent) issues.push('trigger: set the event name');

  const startEdge = edges.find((edge) => edge.source === TRIGGER_ID);
  if (!startEdge) issues.push('trigger: connect it to the first step');

  const definitionNodes: JourneyNode[] = [];
  for (const node of nodes) {
    if (node.id === TRIGGER_ID) continue;
    const position = { x: node.position.x, y: node.position.y };
    if (node.type === 'send_email') {
      const data = node.data as SendEmailData;
      if (!data.templateId) issues.push('send: pick a template');
      definitionNodes.push({
        id: node.id,
        type: 'send_email',
        templateId: data.templateId,
        position,
      });
    } else if (node.type === 'wait') {
      const data = node.data as WaitData;
      const hours = Number(data.hours);
      if (!Number.isFinite(hours) || hours <= 0) issues.push('wait: set a positive duration');
      definitionNodes.push({
        id: node.id,
        type: 'wait',
        seconds: Math.round(hours * 3600),
        position,
      });
    } else if (node.type === 'branch') {
      const data = node.data as BranchData;
      if (!data.attributeKey || !data.value) issues.push('branch: set attribute and value');
      definitionNodes.push({
        id: node.id,
        type: 'branch',
        condition: {
          kind: 'condition',
          target: 'attribute',
          key: data.attributeKey,
          operator: data.operator,
          value: data.value,
        },
        position,
      });
    } else if (node.type === 'end') {
      definitionNodes.push({ id: node.id, type: 'end', position });
    }
  }

  if (issues.length > 0 || !startEdge) return { issues };

  const candidate = {
    trigger: { type: 'event' as const, event: triggerEvent },
    startNodeId: startEdge.target,
    nodes: definitionNodes,
    edges: edges
      .filter((edge) => edge.source !== TRIGGER_ID)
      .map((edge) => ({
        from: edge.source,
        to: edge.target,
        ...(edge.sourceHandle === 'yes' || edge.sourceHandle === 'no'
          ? { label: edge.sourceHandle }
          : {}),
      })),
  };
  const parsed = journeyDefinitionSchema.safeParse(candidate);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((issue) => issue.message) };
  }
  return { definition: parsed.data, issues: [] };
}

/** The node whose single exit is still unconnected — palette auto-wiring. */
export function danglingNodeId(nodes: CanvasNode[], edges: Edge[]): string | null {
  const withExit = new Set(edges.map((edge) => `${edge.source}:${edge.sourceHandle ?? ''}`));
  // Prefer the trigger when untouched, then walk insertion order.
  if (!withExit.has(`${TRIGGER_ID}:`)) return TRIGGER_ID;
  for (const node of nodes) {
    if (node.id === TRIGGER_ID || node.type === 'end') continue;
    if (node.type === 'branch') {
      if (!withExit.has(`${node.id}:yes`)) return node.id;
      if (!withExit.has(`${node.id}:no`)) return node.id;
      continue;
    }
    if (!withExit.has(`${node.id}:`)) return node.id;
  }
  return null;
}
