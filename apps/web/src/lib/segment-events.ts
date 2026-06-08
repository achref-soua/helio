import {
  buildEventConditionQuery,
  eventConditionKey,
  extractEventConditions,
  type SegmentRule,
} from '@helio/core';
import type { EventConditionSets } from '@helio/db';
import { TRPCError } from '@trpc/server';

import { getClickHouse } from './clickhouse';

/** Sets larger than this make IN-list predicates pathological. */
const MAX_SET_SIZE = 50_000;

/**
 * Resolve a rule's behavioral conditions against ClickHouse. Failures
 * surface as actionable preconditions — behavioral segments genuinely
 * need the analytics stack, unlike the read paths that degrade.
 */
export async function resolveEventConditions(
  rule: SegmentRule,
  workspaceId: string,
): Promise<EventConditionSets> {
  const conditions = extractEventConditions(rule);
  const sets: EventConditionSets = new Map();
  if (conditions.length === 0) return sets;

  for (const condition of conditions) {
    const { query, params, mode } = buildEventConditionQuery(condition);
    let rows: Array<{ user_id: string }>;
    try {
      const result = await getClickHouse().query({
        query,
        query_params: { workspaceId, ...params },
        format: 'JSONEachRow',
      });
      rows = (await result.json()) as Array<{ user_id: string }>;
    } catch {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Behavioral conditions need the event store — start the full stack (task up:full)',
      });
    }
    if (rows.length > MAX_SET_SIZE) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This behavioral condition matches too many contacts — narrow the window or event',
      });
    }
    sets.set(eventConditionKey(condition), { mode, emails: rows.map((row) => row.user_id) });
  }
  return sets;
}
