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

export const segmentConditionSchema = z.union([
  fieldConditionSchema,
  attributeConditionSchema,
  statusConditionSchema,
  createdAtConditionSchema,
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
