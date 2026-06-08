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
  z.object({ id: nodeIdSchema, type: z.literal('end'), position: positionSchema.optional() }),
]);
export type JourneyNode = z.infer<typeof journeyNodeSchema>;

export const journeyEdgeSchema = z.object({
  from: nodeIdSchema,
  to: nodeIdSchema,
  /** Branch nodes label their outgoing edges yes/no. */
  label: z.enum(['yes', 'no']).optional(),
});
export type JourneyEdge = z.infer<typeof journeyEdgeSchema>;

export const journeyDefinitionSchema = z
  .object({
    trigger: journeyTriggerSchema,
    startNodeId: nodeIdSchema,
    nodes: z.array(journeyNodeSchema).min(1).max(50),
    edges: z.array(journeyEdgeSchema).max(100),
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
  label?: 'yes' | 'no',
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
