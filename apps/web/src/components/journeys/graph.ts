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
  optimizeSendTime?: boolean;
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
export interface AbSplitData {
  /** Kept as string for the input; parsed on save. */
  ratioA: string;
  [key: string]: unknown;
}
export interface UpdateTraitData {
  key: string;
  value: string;
  [key: string]: unknown;
}
export interface WebhookData {
  url: string;
  [key: string]: unknown;
}
export interface SendPushData {
  title: string;
  body: string;
  url: string;
  [key: string]: unknown;
}
export interface SendSmsData {
  body: string;
  [key: string]: unknown;
}
export interface SendWhatsappData {
  body: string;
  [key: string]: unknown;
}

export interface JourneySettings {
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  quietTimezone: string;
  capEnabled: boolean;
  capMax: string;
  capDays: string;
}

export const DEFAULT_SETTINGS: JourneySettings = {
  quietHoursEnabled: false,
  quietStart: '21:00',
  quietEnd: '08:00',
  quietTimezone: 'UTC',
  capEnabled: false,
  capMax: '3',
  capDays: '7',
};

export function settingsFromDefinition(definition: JourneyDefinition): JourneySettings {
  return {
    quietHoursEnabled: !!definition.quietHours,
    quietStart: definition.quietHours?.start ?? DEFAULT_SETTINGS.quietStart,
    quietEnd: definition.quietHours?.end ?? DEFAULT_SETTINGS.quietEnd,
    quietTimezone: definition.quietHours?.timezone ?? DEFAULT_SETTINGS.quietTimezone,
    capEnabled: !!definition.frequencyCap,
    capMax: String(definition.frequencyCap?.maxEmails ?? DEFAULT_SETTINGS.capMax),
    capDays: String(definition.frequencyCap?.perDays ?? DEFAULT_SETTINGS.capDays),
  };
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
        data: { templateId: node.templateId, optimizeSendTime: node.optimizeSendTime ?? false },
      });
    } else if (node.type === 'wait') {
      nodes.push({
        id: node.id,
        type: 'wait',
        position,
        data: { hours: String(node.seconds / 3600) },
      });
    } else if (node.type === 'ab_split') {
      nodes.push({
        id: node.id,
        type: 'ab_split',
        position,
        data: { ratioA: String(node.ratioA) },
      });
    } else if (node.type === 'update_trait') {
      nodes.push({
        id: node.id,
        type: 'update_trait',
        position,
        data: { key: node.key, value: node.value },
      });
    } else if (node.type === 'webhook') {
      nodes.push({ id: node.id, type: 'webhook', position, data: { url: node.url } });
    } else if (node.type === 'send_push') {
      nodes.push({
        id: node.id,
        type: 'send_push',
        position,
        data: { title: node.title, body: node.body, url: node.url ?? '' },
      });
    } else if (node.type === 'send_sms') {
      nodes.push({ id: node.id, type: 'send_sms', position, data: { body: node.body } });
    } else if (node.type === 'send_whatsapp') {
      nodes.push({ id: node.id, type: 'send_whatsapp', position, data: { body: node.body } });
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

export function canvasToDefinition(
  nodes: CanvasNode[],
  edges: Edge[],
  settings: JourneySettings = DEFAULT_SETTINGS,
): CanvasConversion {
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
        ...(data.optimizeSendTime ? { optimizeSendTime: true } : {}),
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
    } else if (node.type === 'ab_split') {
      const data = node.data as AbSplitData;
      const ratio = Number(data.ratioA);
      if (!Number.isInteger(ratio) || ratio < 1 || ratio > 99) {
        issues.push('A/B split: ratio must be 1–99');
      }
      definitionNodes.push({ id: node.id, type: 'ab_split', ratioA: ratio, position });
    } else if (node.type === 'update_trait') {
      const data = node.data as UpdateTraitData;
      if (!data.key) issues.push('update trait: set the attribute name');
      definitionNodes.push({
        id: node.id,
        type: 'update_trait',
        key: data.key,
        value: data.value,
        position,
      });
    } else if (node.type === 'webhook') {
      const data = node.data as WebhookData;
      const valid = (() => {
        try {
          return ['http:', 'https:'].includes(new URL(data.url).protocol);
        } catch {
          return false;
        }
      })();
      if (!valid) issues.push('webhook: enter a valid URL');
      definitionNodes.push({ id: node.id, type: 'webhook', url: data.url, position });
    } else if (node.type === 'send_push') {
      const data = node.data as SendPushData;
      if (!data.title.trim() || !data.body.trim()) issues.push('push: set a title and body');
      definitionNodes.push({
        id: node.id,
        type: 'send_push',
        title: data.title,
        body: data.body,
        ...(data.url.trim() ? { url: data.url.trim() } : {}),
        position,
      });
    } else if (node.type === 'send_sms') {
      const data = node.data as SendSmsData;
      if (!data.body.trim()) issues.push('sms: enter a message');
      definitionNodes.push({ id: node.id, type: 'send_sms', body: data.body, position });
    } else if (node.type === 'send_whatsapp') {
      const data = node.data as SendWhatsappData;
      if (!data.body.trim()) issues.push('whatsapp: enter a message');
      definitionNodes.push({ id: node.id, type: 'send_whatsapp', body: data.body, position });
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
        ...(edge.sourceHandle === 'yes' ||
        edge.sourceHandle === 'no' ||
        edge.sourceHandle === 'a' ||
        edge.sourceHandle === 'b'
          ? { label: edge.sourceHandle as 'yes' | 'no' | 'a' | 'b' }
          : {}),
      })),
    ...(settings.quietHoursEnabled
      ? {
          quietHours: {
            start: settings.quietStart,
            end: settings.quietEnd,
            timezone: settings.quietTimezone,
          },
        }
      : {}),
    ...(settings.capEnabled
      ? {
          frequencyCap: {
            maxEmails: Number(settings.capMax),
            perDays: Number(settings.capDays),
          },
        }
      : {}),
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
    if (node.type === 'ab_split') {
      if (!withExit.has(`${node.id}:a`)) return node.id;
      if (!withExit.has(`${node.id}:b`)) return node.id;
      continue;
    }
    if (!withExit.has(`${node.id}:`)) return node.id;
  }
  return null;
}
