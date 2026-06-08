import { z } from 'zod';

import { segmentConditionSchema } from './segments';

/**
 * Journey definitions: a validated DAG the canvas edits and the
 * Temporal workflow walks. Positions ride along so the canvas restores
 * exactly as drawn; the engine ignores them.
 */

const nodeIdSchema = z.string().min(1).max(64);
const positionSchema = z.object({ x: z.number(), y: z.number() });

export const journeyTriggerSchema = z.object({
  type: z.literal('event'),
  /** Tracked event name that enrolls a contact (e.g. "Signed Up"). */
  event: z.string().trim().min(1).max(200),
});

export const journeyNodeSchema = z.discriminatedUnion('type', [
  z.object({
    id: nodeIdSchema,
    type: z.literal('send_email'),
    templateId: z.string().min(1),
    position: positionSchema.optional(),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal('wait'),
    /** Durable timer — minutes to 90 days. */
    seconds: z
      .number()
      .int()
      .min(10)
      .max(90 * 24 * 60 * 60),
    position: positionSchema.optional(),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal('branch'),
    /** Contact condition deciding the yes/no edge. */
    condition: segmentConditionSchema,
    position: positionSchema.optional(),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal('ab_split'),
    /** Percentage of contacts routed to the 'a' edge (the rest take 'b'). */
    ratioA: z.number().int().min(1).max(99),
    position: positionSchema.optional(),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal('update_trait'),
    key: z.string().trim().min(1).max(100),
    value: z.string().max(200),
    position: positionSchema.optional(),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal('webhook'),
    url: z.string().trim().url().max(2048),
    position: positionSchema.optional(),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal('send_push'),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(300),
    url: z.string().trim().url().max(2048).optional(),
    position: positionSchema.optional(),
  }),
  z.object({ id: nodeIdSchema, type: z.literal('end'), position: positionSchema.optional() }),
]);
export type JourneyNode = z.infer<typeof journeyNodeSchema>;

export const journeyEdgeSchema = z.object({
  from: nodeIdSchema,
  to: nodeIdSchema,
  /** Branch edges are yes/no; A/B-split edges are a/b. */
  label: z.enum(['yes', 'no', 'a', 'b']).optional(),
});
export type JourneyEdge = z.infer<typeof journeyEdgeSchema>;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');

/** Sends pause inside the window (start may wrap past midnight). */
export const quietHoursSchema = z.object({
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  /** IANA zone the window is evaluated in (contact zones arrive later). */
  timezone: z.string().min(1).max(64).default('UTC'),
});
export type QuietHours = z.infer<typeof quietHoursSchema>;

/** At most maxEmails to a contact within perDays — across all sources. */
export const frequencyCapSchema = z.object({
  maxEmails: z.number().int().min(1).max(100),
  perDays: z.number().int().min(1).max(90),
});
export type FrequencyCap = z.infer<typeof frequencyCapSchema>;

export const journeyDefinitionSchema = z
  .object({
    trigger: journeyTriggerSchema,
    startNodeId: nodeIdSchema,
    nodes: z.array(journeyNodeSchema).min(1).max(50),
    edges: z.array(journeyEdgeSchema).max(100),
    quietHours: quietHoursSchema.optional(),
    frequencyCap: frequencyCapSchema.optional(),
  })
  .superRefine((definition, ctx) => {
    const ids = new Set<string>();
    for (const node of definition.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate node id "${node.id}"` });
      }
      ids.add(node.id);
    }
    if (!ids.has(definition.startNodeId)) {
      ctx.addIssue({ code: 'custom', message: 'startNodeId references a missing node' });
    }
    for (const edge of definition.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        ctx.addIssue({
          code: 'custom',
          message: `edge ${edge.from}→${edge.to} references a missing node`,
        });
      }
    }

    const byType = new Map(definition.nodes.map((node) => [node.id, node.type]));
    const outgoing = new Map<string, JourneyEdge[]>();
    for (const edge of definition.edges) {
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge);
      outgoing.set(edge.from, list);
    }
    for (const node of definition.nodes) {
      const edges = outgoing.get(node.id) ?? [];
      if (node.type === 'branch') {
        const labels = new Set(edges.map((edge) => edge.label));
        if (edges.length !== 2 || !labels.has('yes') || !labels.has('no')) {
          ctx.addIssue({
            code: 'custom',
            message: `branch "${node.id}" needs exactly one yes and one no edge`,
          });
        }
      } else if (node.type === 'ab_split') {
        const labels = new Set(edges.map((edge) => edge.label));
        if (edges.length !== 2 || !labels.has('a') || !labels.has('b')) {
          ctx.addIssue({
            code: 'custom',
            message: `A/B split "${node.id}" needs exactly one a and one b edge`,
          });
        }
      } else if (node.type === 'end') {
        if (edges.length > 0) {
          ctx.addIssue({ code: 'custom', message: `end "${node.id}" cannot have outgoing edges` });
        }
      } else if (edges.length > 1) {
        ctx.addIssue({
          code: 'custom',
          message: `${byType.get(node.id)} "${node.id}" can have at most one outgoing edge`,
        });
      }
    }

    // Cycle check (the walk must terminate without step budgets).
    const colors = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string): boolean => {
      const color = colors.get(id);
      if (color === 'visiting') return false;
      if (color === 'done') return true;
      colors.set(id, 'visiting');
      for (const edge of outgoing.get(id) ?? []) {
        if (!visit(edge.to)) return false;
      }
      colors.set(id, 'done');
      return true;
    };
    if (ids.has(definition.startNodeId) && !visit(definition.startNodeId)) {
      ctx.addIssue({ code: 'custom', message: 'the journey graph must not contain cycles' });
    }
  });

export type JourneyDefinition = z.infer<typeof journeyDefinitionSchema>;

/** Engine helper: the node an edge walk reaches next, or null to stop. */
export function nextNodeId(
  definition: JourneyDefinition,
  fromNodeId: string,
  label?: 'yes' | 'no' | 'a' | 'b',
): string | null {
  const edge = definition.edges.find(
    (candidate) =>
      candidate.from === fromNodeId && (label === undefined || candidate.label === label),
  );
  return edge?.to ?? null;
}

export function journeyNodeById(definition: JourneyDefinition, nodeId: string): JourneyNode | null {
  return definition.nodes.find((node) => node.id === nodeId) ?? null;
}

/**
 * Milliseconds to defer a send so it lands outside quiet hours; 0 when
 * sending is allowed now. Pure so the engine can call it from an
 * activity and unit tests can pin the clock and zone.
 */
export function quietHoursDelayMs(quiet: QuietHours, now: Date): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: quiet.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const [hourPart, minutePart] = formatter.format(now).split(':');
  const nowMinutes = Number(hourPart) * 60 + Number(minutePart);
  const [startH, startM] = quiet.start.split(':').map(Number);
  const [endH, endM] = quiet.end.split(':').map(Number);
  const start = startH! * 60 + startM!;
  const end = endH! * 60 + endM!;

  const inWindow =
    start <= end
      ? nowMinutes >= start && nowMinutes < end // same-day window
      : nowMinutes >= start || nowMinutes < end; // wraps past midnight
  if (!inWindow) return 0;

  const minutesUntilEnd = end > nowMinutes ? end - nowMinutes : 24 * 60 - nowMinutes + end;
  // Land just past the boundary; second-of-minute drift is irrelevant here.
  return minutesUntilEnd * 60_000;
}
