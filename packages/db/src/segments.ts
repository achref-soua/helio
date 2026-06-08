import type { SegmentCondition, SegmentRule, SegmentRuleGroup, StringOperator } from '@helio/core';
import { eventConditionKey } from '@helio/core';

import { Prisma } from './generated/prisma/client';

type ContactWhere = Prisma.ContactWhereInput;

/** Resolved behavioral sets: eventConditionKey → contact emails. */
export type EventConditionSets = Map<string, { mode: 'in' | 'notIn'; emails: string[] }>;

/**
 * Compile a validated segment rule tree into a Prisma predicate over
 * contacts. Callers AND the result with their tenancy scope
 * (workspaceId); RLS keeps the org boundary regardless. Rules with
 * event conditions need their ClickHouse sets resolved first
 * (extractEventConditions → buildEventConditionQuery) and passed in.
 */
export function compileSegmentRule(
  rule: SegmentRule,
  eventSets?: EventConditionSets,
): ContactWhere {
  return compileGroup(rule, eventSets);
}

function compileGroup(group: SegmentRuleGroup, eventSets?: EventConditionSets): ContactWhere {
  const children = group.children.map((child) =>
    child.kind === 'group' ? compileGroup(child, eventSets) : compileCondition(child, eventSets),
  );
  if (children.length === 1) return children[0]!;
  return group.op === 'and' ? { AND: children } : { OR: children };
}

function compileCondition(
  condition: SegmentCondition,
  eventSets?: EventConditionSets,
): ContactWhere {
  switch (condition.target) {
    case 'field':
      return compileField(
        condition.field,
        condition.operator,
        'value' in condition ? condition.value : undefined,
      );
    case 'attribute':
      return compileAttribute(
        condition.key,
        condition.operator,
        'value' in condition ? condition.value : undefined,
      );
    case 'status':
      return condition.operator === 'equals'
        ? { status: condition.value }
        : { status: { not: condition.value } };
    case 'event': {
      const resolved = eventSets?.get(eventConditionKey(condition));
      if (!resolved) {
        throw new Error(
          'segment rule contains behavioral conditions — resolve them against the event store first',
        );
      }
      return resolved.mode === 'in'
        ? { email: { in: resolved.emails } }
        : { email: { notIn: resolved.emails } };
    }
    case 'score':
      return condition.operator === 'gte'
        ? { score: { gte: condition.value } }
        : condition.operator === 'lte'
          ? { score: { lte: condition.value } }
          : { score: condition.value };
    case 'created_at': {
      if (condition.operator === 'in_last_days') {
        const since = new Date(Date.now() - condition.value * 24 * 60 * 60 * 1000);
        return { createdAt: { gte: since } };
      }
      const moment = new Date(condition.value);
      return condition.operator === 'before'
        ? { createdAt: { lt: moment } }
        : { createdAt: { gt: moment } };
    }
  }
}

const insensitive = 'insensitive' as const;

function compileField(
  field: 'email' | 'firstName' | 'lastName',
  operator: StringOperator,
  value: string | undefined,
): ContactWhere {
  switch (operator) {
    case 'equals':
      return { [field]: { equals: value, mode: insensitive } };
    case 'not_equals':
      // SQL three-valued logic drops NULLs from NOT(=); a NULL name
      // should still count as "not equal", so OR it back in.
      return field === 'email'
        ? { NOT: { [field]: { equals: value, mode: insensitive } } }
        : { OR: [{ NOT: { [field]: { equals: value, mode: insensitive } } }, { [field]: null }] };
    case 'contains':
      return { [field]: { contains: value, mode: insensitive } };
    case 'not_contains':
      return field === 'email'
        ? { NOT: { [field]: { contains: value, mode: insensitive } } }
        : { OR: [{ NOT: { [field]: { contains: value, mode: insensitive } } }, { [field]: null }] };
    case 'starts_with':
      return { [field]: { startsWith: value, mode: insensitive } };
    case 'ends_with':
      return { [field]: { endsWith: value, mode: insensitive } };
    case 'is_set':
      // email is non-nullable; "set" still reads naturally.
      return field === 'email' ? {} : { [field]: { not: null } };
    case 'is_not_set':
      return field === 'email' ? { id: { in: [] } } : { [field]: null };
  }
}

function compileAttribute(
  key: string,
  operator: StringOperator,
  value: string | undefined,
): ContactWhere {
  const path = [key];
  switch (operator) {
    case 'equals':
      return { attributes: { path, equals: value } };
    case 'not_equals':
      // Missing keys extract to SQL NULL, which NOT(=) drops — OR the
      // "key absent" case back in so it counts as "not equal".
      return {
        OR: [
          { NOT: { attributes: { path, equals: value } } },
          { attributes: { path, equals: Prisma.DbNull } },
        ],
      };
    case 'contains':
      return { attributes: { path, string_contains: value } };
    case 'not_contains':
      return {
        AND: [
          { NOT: { attributes: { path, string_contains: value } } },
          { NOT: { attributes: { path, equals: Prisma.DbNull } } },
        ],
      };
    case 'starts_with':
      return { attributes: { path, string_starts_with: value } };
    case 'ends_with':
      return { attributes: { path, string_ends_with: value } };
    case 'is_set':
      return { NOT: { attributes: { path, equals: Prisma.DbNull } } };
    case 'is_not_set':
      return { attributes: { path, equals: Prisma.DbNull } };
  }
}
