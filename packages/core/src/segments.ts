import { z } from 'zod';

/**
 * Segment rules: a nested AND/OR tree of conditions over contact data.
 * The tree is stored as JSON on the segment and compiled to a database
 * predicate at query time (packages/db), so dynamic segments are always
 * live — no materialization in Phase 1.
 */

export const STRING_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_set',
  'is_not_set',
] as const;
export type StringOperator = (typeof STRING_OPERATORS)[number];

export const CONTACT_FIELDS = ['email', 'firstName', 'lastName'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export const CONTACT_STATUSES = ['ACTIVE', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED'] as const;

const valuedStringOperator = z.enum(
  STRING_OPERATORS.filter((op) => op !== 'is_set' && op !== 'is_not_set') as [
    StringOperator,
    ...StringOperator[],
  ],
);

/** Contact column conditions (email, first/last name). */
const fieldConditionSchema = z.union([
  z.object({
    kind: z.literal('condition'),
    target: z.literal('field'),
    field: z.enum(CONTACT_FIELDS),
    operator: valuedStringOperator,
    value: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal('condition'),
    target: z.literal('field'),
    field: z.enum(CONTACT_FIELDS),
    operator: z.enum(['is_set', 'is_not_set']),
  }),
]);

/** Conditions over the free-form attributes JSON (string values). */
const attributeConditionSchema = z.union([
  z.object({
    kind: z.literal('condition'),
    target: z.literal('attribute'),
    key: z.string().trim().min(1).max(100),
    operator: valuedStringOperator,
    value: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal('condition'),
    target: z.literal('attribute'),
    key: z.string().trim().min(1).max(100),
    operator: z.enum(['is_set', 'is_not_set']),
  }),
]);

const statusConditionSchema = z.object({
  kind: z.literal('condition'),
  target: z.literal('status'),
  operator: z.enum(['equals', 'not_equals']),
  value: z.enum(CONTACT_STATUSES),
});

const createdAtConditionSchema = z.union([
  z.object({
    kind: z.literal('condition'),
    target: z.literal('created_at'),
    operator: z.enum(['before', 'after']),
    value: z.iso.datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal('condition'),
    target: z.literal('created_at'),
    operator: z.literal('in_last_days'),
    value: z.number().int().min(1).max(3650),
  }),
]);

const scoreConditionSchema = z.object({
  kind: z.literal('condition'),
  target: z.literal('score'),
  operator: z.enum(['gte', 'lte', 'equals']),
  value: z.number().int().min(-100000).max(100000),
});

/** AI prediction conditions (conversion propensity / churn risk), both
 * probabilities in [0,1] recomputed in batches by the intelligence plane. */
export const PREDICTION_METRICS = ['conversionProbability', 'churnRisk'] as const;
const predictionConditionSchema = z.object({
  kind: z.literal('condition'),
  target: z.literal('prediction'),
  metric: z.enum(PREDICTION_METRICS),
  operator: z.enum(['gte', 'lte']),
  value: z.number().min(0).max(1),
});

/** Behavioral condition over the event store (resolved via ClickHouse). */
const eventConditionSchema = z.object({
  kind: z.literal('condition'),
  target: z.literal('event'),
  event: z.string().trim().min(1).max(200),
  operator: z.enum(['at_least', 'at_most', 'never']),
  /** Occurrence threshold; ignored for 'never'. */
  count: z.number().int().min(1).max(10_000).default(1),
  inLastDays: z.number().int().min(1).max(365),
});

export const segmentConditionSchema = z.union([
  fieldConditionSchema,
  attributeConditionSchema,
  statusConditionSchema,
  createdAtConditionSchema,
  eventConditionSchema,
  scoreConditionSchema,
  predictionConditionSchema,
]);
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

export interface SegmentRuleGroup {
  kind: 'group';
  op: 'and' | 'or';
  children: Array<SegmentRuleGroup | SegmentCondition>;
}

const MAX_DEPTH = 5;

const groupSchema: z.ZodType<SegmentRuleGroup> = z.lazy(() =>
  z.object({
    kind: z.literal('group'),
    op: z.enum(['and', 'or']),
    children: z
      .array(z.union([groupSchema, segmentConditionSchema]))
      .min(1)
      .max(20),
  }),
);

/** Root rule: a group, depth- and size-capped to keep queries sane. */
export const segmentRuleSchema = groupSchema
  .refine((root) => depthOf(root) <= MAX_DEPTH, {
    message: `rule groups nest at most ${MAX_DEPTH} levels`,
  })
  .refine((root) => countConditions(root) <= 50, {
    message: 'a segment holds at most 50 conditions',
  });

export type SegmentRule = z.infer<typeof segmentRuleSchema>;

function depthOf(node: SegmentRuleGroup | SegmentCondition): number {
  if (node.kind === 'condition') return 0;
  return 1 + Math.max(0, ...node.children.map(depthOf));
}

export function countConditions(node: SegmentRuleGroup | SegmentCondition): number {
  if (node.kind === 'condition') return 1;
  return node.children.reduce((sum, child) => sum + countConditions(child), 0);
}

export type EventCondition = Extract<SegmentCondition, { target: 'event' }>;

/** Stable identity for resolver maps. */
export function eventConditionKey(condition: EventCondition): string {
  return JSON.stringify([
    condition.event,
    condition.operator,
    condition.count,
    condition.inLastDays,
  ]);
}

/** Every event condition in the tree (deduped by key). */
export function extractEventConditions(
  node: SegmentRuleGroup | SegmentCondition,
): EventCondition[] {
  if (node.kind === 'condition') {
    return node.target === 'event' ? [node] : [];
  }
  const seen = new Map<string, EventCondition>();
  for (const child of node.children) {
    for (const condition of extractEventConditions(child)) {
      seen.set(eventConditionKey(condition), condition);
    }
  }
  return [...seen.values()];
}

/**
 * ClickHouse query for one event condition: the user_ids (contact
 * emails) that SATISFY 'at_least', or that EXCEED the bound for
 * 'at_most'/'never' — callers filter NOT IN for those two. Parameterized;
 * executors bind {workspaceId}, {event}, {days}, {count}.
 */
export function buildEventConditionQuery(condition: EventCondition): {
  query: string;
  params: { event: string; days: number; count: number };
  /** How the email set applies against contacts. */
  mode: 'in' | 'notIn';
} {
  const having =
    condition.operator === 'at_least'
      ? 'HAVING count() >= {count:UInt32}'
      : condition.operator === 'at_most'
        ? 'HAVING count() > {count:UInt32}'
        : 'HAVING count() >= 1';
  return {
    query: `
      SELECT user_id
      FROM events
      WHERE workspace_id = {workspaceId:String}
        AND event = {event:String}
        AND user_id != ''
        AND timestamp >= now() - INTERVAL {days:UInt16} DAY
      GROUP BY user_id
      ${having}`,
    params: {
      event: condition.event,
      days: condition.inLastDays,
      count: condition.operator === 'never' ? 1 : condition.count,
    },
    mode: condition.operator === 'at_least' ? 'in' : 'notIn',
  };
}
