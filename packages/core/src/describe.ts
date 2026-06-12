import type { JourneyDefinition } from './journeys';
import type { SegmentCondition, SegmentRule, SegmentRuleGroup } from './segments';

/**
 * Plain-language rendering of the canonical documents — the segment rule
 * and the journey definition — so the dashboard (and the copilot's draft
 * previews) can show people what a document MEANS instead of its JSON.
 * English-only by design: these strings describe machine documents, the
 * way code comments do; the surrounding UI chrome is what localizes.
 */

const STRING_OP_WORDS: Record<string, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: "doesn't contain",
  starts_with: 'starts with',
  ends_with: 'ends with',
};

export function describeSegmentCondition(condition: SegmentCondition): string {
  switch (condition.target) {
    case 'field':
      // 'value' presence is the discriminant between the valued and the
      // is_set/is_not_set variants of the union.
      return 'value' in condition
        ? `${condition.field} ${STRING_OP_WORDS[condition.operator]} “${condition.value}”`
        : `${condition.field} ${condition.operator === 'is_set' ? 'is set' : 'is not set'}`;
    case 'attribute':
      return 'value' in condition
        ? `${condition.key} ${STRING_OP_WORDS[condition.operator]} “${condition.value}”`
        : `${condition.key} ${condition.operator === 'is_set' ? 'is set' : 'is not set'}`;
    case 'status':
      return `status ${condition.operator === 'equals' ? 'is' : 'is not'} ${condition.value.toLowerCase()}`;
    case 'created_at':
      return condition.operator === 'in_last_days'
        ? `joined in the last ${condition.value} days`
        : `joined ${condition.operator} ${condition.value.slice(0, 10)}`;
    case 'score':
      return `lead score ${condition.operator === 'gte' ? '≥' : condition.operator === 'lte' ? '≤' : '='} ${condition.value}`;
    case 'prediction': {
      const metric =
        condition.metric === 'conversionProbability' ? 'conversion likelihood' : 'churn risk';
      return `${metric} ${condition.operator === 'gte' ? '≥' : '≤'} ${Math.round(condition.value * 100)}%`;
    }
    case 'event': {
      if (condition.operator === 'never') {
        return `never did “${condition.event}” in the last ${condition.inLastDays} days`;
      }
      const bound = condition.operator === 'at_least' ? 'at least' : 'at most';
      return `did “${condition.event}” ${bound} ${condition.count}× in the last ${condition.inLastDays} days`;
    }
  }
}

/** "plan is “pro” and (lead score ≥ 70 or churn risk ≥ 60%)" */
export function describeSegmentRule(rule: SegmentRule | SegmentRuleGroup, depth = 0): string {
  const parts = rule.children.map((child) =>
    child.kind === 'group'
      ? describeSegmentRule(child, depth + 1)
      : describeSegmentCondition(child),
  );
  if (parts.length === 0) return 'everyone';
  const joined = parts.join(rule.op === 'and' ? ' and ' : ' or ');
  return depth > 0 && parts.length > 1 ? `(${joined})` : joined;
}

export interface JourneyStepSummary {
  id: string;
  type: JourneyDefinition['nodes'][number]['type'];
  /** One line saying what the step does. */
  summary: string;
  /** The edge label that led here ('yes' | 'no' | 'a' | 'b'), if any. */
  via?: 'yes' | 'no' | 'a' | 'b';
}

function nodeSummary(node: JourneyDefinition['nodes'][number]): string {
  switch (node.type) {
    case 'send_email':
      return 'Send email';
    case 'wait': {
      const days = node.seconds / 86_400;
      if (Number.isInteger(days) && days >= 1) return `Wait ${days} day${days === 1 ? '' : 's'}`;
      const hours = node.seconds / 3_600;
      if (Number.isInteger(hours) && hours >= 1)
        return `Wait ${hours} hour${hours === 1 ? '' : 's'}`;
      return `Wait ${node.seconds}s`;
    }
    case 'branch':
      return `If ${describeSegmentCondition(node.condition)}`;
    case 'ab_split':
      return `A/B split ${node.ratioA}/${100 - node.ratioA}`;
    case 'update_trait':
      return `Set ${node.key} = “${node.value}”`;
    case 'webhook':
      return `Call webhook`;
    case 'send_push':
      return 'Send web push';
    case 'send_sms':
      return 'Send SMS';
    case 'send_whatsapp':
      return 'Send WhatsApp';
    case 'send_in_app':
      return 'Show in-app message';
    case 'end':
      return 'End';
  }
}

/**
 * The journey flattened to readable steps: breadth-first from the start
 * node so branches read in order, each step carrying the edge label that
 * reaches it. Cycles and dangling edges cannot loop this (visited set,
 * hard cap).
 */
export function summarizeJourney(definition: JourneyDefinition): JourneyStepSummary[] {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const steps: JourneyStepSummary[] = [];
  const visited = new Set<string>();
  const queue: Array<{ id: string; via?: 'yes' | 'no' | 'a' | 'b' }> = [
    { id: definition.startNodeId },
  ];
  while (queue.length > 0 && steps.length < 50) {
    const { id, via } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodesById.get(id);
    if (!node) continue;
    steps.push({ id, type: node.type, summary: nodeSummary(node), via });
    for (const edge of definition.edges.filter((candidate) => candidate.from === id)) {
      queue.push({ id: edge.to, via: edge.label });
    }
  }
  return steps;
}
