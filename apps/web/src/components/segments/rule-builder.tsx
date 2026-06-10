'use client';

import {
  CONTACT_FIELDS,
  CONTACT_STATUSES,
  PREDICTION_METRICS,
  type SegmentRule,
  segmentRuleSchema,
} from '@helio/core';
import { Button } from '@helio/ui/components/button';
import { Input } from '@helio/ui/components/input';
import { cn } from '@helio/ui/lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ThemedSelect } from '@/components/themed-select';

/**
 * Draft tree the builder edits: conditions may be incomplete while the
 * user types. toSegmentRule() converts a draft into the strict rule
 * shape (or null when something is still incomplete).
 */
export interface DraftCondition {
  id: string;
  kind: 'condition';
  target: 'field' | 'attribute' | 'status' | 'created_at' | 'event' | 'score' | 'prediction';
  field: (typeof CONTACT_FIELDS)[number];
  attributeKey: string;
  operator: string;
  value: string;
  eventName: string;
  eventCount: string;
  eventDays: string;
  predictionMetric: (typeof PREDICTION_METRICS)[number];
}

export interface DraftGroup {
  id: string;
  kind: 'group';
  op: 'and' | 'or';
  children: Array<DraftGroup | DraftCondition>;
}

let draftIdCounter = 0;
const draftId = () => `draft-${++draftIdCounter}`;

export function newDraftCondition(): DraftCondition {
  return {
    id: draftId(),
    kind: 'condition',
    target: 'field',
    field: 'email',
    attributeKey: '',
    operator: 'contains',
    value: '',
    eventName: '',
    eventCount: '1',
    eventDays: '30',
    predictionMetric: 'churnRisk',
  };
}

export function newDraftGroup(children: Array<DraftGroup | DraftCondition> = []): DraftGroup {
  return { id: draftId(), kind: 'group', op: 'and', children };
}

const FIELD_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_set',
  'is_not_set',
] as const;
const STATUS_OPERATORS = ['equals', 'not_equals'] as const;
const CREATED_OPERATORS = ['in_last_days', 'before', 'after'] as const;
const EVENT_OPERATORS = ['at_least', 'at_most', 'never'] as const;
const SCORE_OPERATORS = ['gte', 'lte', 'equals'] as const;
const PREDICTION_OPERATORS = ['gte', 'lte'] as const;

const VALUELESS = new Set(['is_set', 'is_not_set']);

function operatorsFor(target: DraftCondition['target']): readonly string[] {
  if (target === 'status') return STATUS_OPERATORS;
  if (target === 'created_at') return CREATED_OPERATORS;
  if (target === 'event') return EVENT_OPERATORS;
  if (target === 'score') return SCORE_OPERATORS;
  if (target === 'prediction') return PREDICTION_OPERATORS;
  return FIELD_OPERATORS;
}

/** Convert a draft tree to the strict rule shape; null while incomplete. */
export function toSegmentRule(draft: DraftGroup): SegmentRule | null {
  const node = groupToRule(draft);
  if (!node) return null;
  const parsed = segmentRuleSchema.safeParse(node);
  return parsed.success ? parsed.data : null;
}

function groupToRule(group: DraftGroup): unknown {
  const children = group.children
    .map((child) => (child.kind === 'group' ? groupToRule(child) : conditionToRule(child)))
    .filter((child) => child !== null);
  if (children.length === 0) return null;
  return { kind: 'group', op: group.op, children };
}

function conditionToRule(condition: DraftCondition): unknown {
  const { target, operator } = condition;
  if (target === 'field') {
    if (VALUELESS.has(operator)) {
      return { kind: 'condition', target, field: condition.field, operator };
    }
    if (!condition.value) return null;
    return { kind: 'condition', target, field: condition.field, operator, value: condition.value };
  }
  if (target === 'attribute') {
    if (!condition.attributeKey) return null;
    if (VALUELESS.has(operator)) {
      return { kind: 'condition', target, key: condition.attributeKey, operator };
    }
    if (!condition.value) return null;
    return {
      kind: 'condition',
      target,
      key: condition.attributeKey,
      operator,
      value: condition.value,
    };
  }
  if (target === 'status') {
    if (!condition.value) return null;
    return { kind: 'condition', target, operator, value: condition.value };
  }
  if (target === 'score') {
    const value = Number(condition.value);
    if (!Number.isInteger(value)) return null;
    return { kind: 'condition', target, operator, value };
  }
  if (target === 'prediction') {
    const value = Number(condition.value);
    if (Number.isNaN(value) || value < 0 || value > 1) return null;
    return { kind: 'condition', target, metric: condition.predictionMetric, operator, value };
  }
  if (target === 'event') {
    if (!condition.eventName.trim()) return null;
    const days = Number(condition.eventDays);
    const count = Number(condition.eventCount);
    if (!Number.isInteger(days) || days < 1) return null;
    if (operator !== 'never' && (!Number.isInteger(count) || count < 1)) return null;
    return {
      kind: 'condition',
      target,
      event: condition.eventName.trim(),
      operator,
      count: operator === 'never' ? 1 : count,
      inLastDays: days,
    };
  }
  // created_at
  if (operator === 'in_last_days') {
    const days = Number(condition.value);
    if (!Number.isInteger(days) || days < 1) return null;
    return { kind: 'condition', target, operator, value: days };
  }
  if (!condition.value) return null;
  const iso = new Date(condition.value);
  if (Number.isNaN(iso.getTime())) return null;
  return { kind: 'condition', target, operator, value: iso.toISOString() };
}

function mutateTree(
  group: DraftGroup,
  targetId: string,
  mutate: (children: Array<DraftGroup | DraftCondition>, index: number) => void,
): DraftGroup {
  const children = group.children.map((child) =>
    child.kind === 'group' ? mutateTree(child, targetId, mutate) : child,
  );
  const index = children.findIndex((child) => child.id === targetId);
  if (index !== -1) mutate(children, index);
  return { ...group, children };
}

export function RuleGroupEditor({
  group,
  onChange,
  depth = 0,
  maxDepth = 4,
}: {
  group: DraftGroup;
  onChange: (next: DraftGroup) => void;
  depth?: number;
  maxDepth?: number;
}) {
  const t = useTranslations('segments.builder');

  const replaceChild = (id: string, next: DraftGroup | DraftCondition) =>
    onChange(mutateTree(group, id, (children, index) => children.splice(index, 1, next)));
  const removeChild = (id: string) =>
    onChange(mutateTree(group, id, (children, index) => children.splice(index, 1)));

  return (
    <div
      data-testid={depth === 0 ? 'rule-root' : undefined}
      className={cn('grid gap-2 rounded-md border p-3', depth > 0 && 'bg-muted/30')}
    >
      <div className="flex items-center gap-2">
        <ThemedSelect
          aria-label={t('groupOp')}
          value={group.op}
          onValueChange={(op) => onChange({ ...group, op: op as 'and' | 'or' })}
          className="w-28"
          options={[
            { value: 'and', label: t('matchAll') },
            { value: 'or', label: t('matchAny') },
          ]}
        />
        <span className="text-muted-foreground text-sm">{t('ofTheFollowing')}</span>
      </div>

      {group.children.map((child) =>
        child.kind === 'group' ? (
          <div key={child.id} className="relative">
            <RuleGroupEditor
              group={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              onChange={(next) => replaceChild(child.id, next)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('removeGroup')}
              className="absolute top-2 right-2"
              onClick={() => removeChild(child.id)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ) : (
          <ConditionEditor
            key={child.id}
            condition={child}
            onChange={(next) => replaceChild(child.id, next)}
            onRemove={() => removeChild(child.id)}
          />
        ),
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...group, children: [...group.children, newDraftCondition()] })}
        >
          <Plus aria-hidden /> {t('addCondition')}
        </Button>
        {depth < maxDepth - 1 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...group,
                children: [...group.children, newDraftGroup([newDraftCondition()])],
              })
            }
          >
            <Plus aria-hidden /> {t('addGroup')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
}: {
  condition: DraftCondition;
  onChange: (next: DraftCondition) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('segments.builder');
  const operators = operatorsFor(condition.target);

  function setTarget(target: DraftCondition['target']) {
    onChange({
      ...condition,
      target,
      operator: operatorsFor(target)[0]!,
      value: target === 'status' ? 'ACTIVE' : '',
    });
  }

  const isEvent = condition.target === 'event';

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="condition-row">
      <ThemedSelect
        aria-label={t('target')}
        value={condition.target === 'field' ? `field:${condition.field}` : condition.target}
        onValueChange={(selected) => {
          if (selected.startsWith('field:')) {
            onChange({
              ...condition,
              target: 'field',
              field: selected.slice('field:'.length) as DraftCondition['field'],
              operator: condition.target === 'field' ? condition.operator : 'contains',
            });
          } else {
            setTarget(selected as DraftCondition['target']);
          }
        }}
        className="w-40"
        options={[
          ...CONTACT_FIELDS.map((field) => ({
            value: `field:${field}`,
            label: t(`fields.${field}`),
          })),
          { value: 'attribute', label: t('fields.attribute') },
          { value: 'status', label: t('fields.status') },
          { value: 'created_at', label: t('fields.createdAt') },
          { value: 'event', label: t('fields.event') },
          { value: 'score', label: t('fields.score') },
          { value: 'prediction', label: t('fields.prediction') },
        ]}
      />

      {condition.target === 'prediction' && (
        <ThemedSelect
          aria-label={t('predictionMetric')}
          value={condition.predictionMetric}
          onValueChange={(metric) =>
            onChange({
              ...condition,
              predictionMetric: metric as DraftCondition['predictionMetric'],
            })
          }
          className="w-44"
          options={PREDICTION_METRICS.map((metric) => ({
            value: metric,
            label: t(`metrics.${metric}`),
          }))}
        />
      )}

      {isEvent && (
        <Input
          aria-label={t('eventName')}
          placeholder={t('eventNamePlaceholder')}
          value={condition.eventName}
          onChange={(event) => onChange({ ...condition, eventName: event.target.value })}
          className="w-44"
        />
      )}

      {condition.target === 'attribute' && (
        <Input
          aria-label={t('attributeKey')}
          placeholder={t('attributeKeyPlaceholder')}
          value={condition.attributeKey}
          onChange={(event) => onChange({ ...condition, attributeKey: event.target.value })}
          className="w-36"
        />
      )}

      <ThemedSelect
        aria-label={t('operator')}
        value={condition.operator}
        onValueChange={(operator) => onChange({ ...condition, operator })}
        className="w-40"
        options={operators.map((operator) => ({
          value: operator,
          label: t(`operators.${operator}`),
        }))}
      />

      {isEvent && condition.operator !== 'never' && (
        <Input
          aria-label={t('eventCount')}
          type="number"
          min={1}
          value={condition.eventCount}
          onChange={(event) => onChange({ ...condition, eventCount: event.target.value })}
          className="w-20"
        />
      )}
      {isEvent && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          {t('inLast')}
          <Input
            aria-label={t('eventDays')}
            type="number"
            min={1}
            value={condition.eventDays}
            onChange={(event) => onChange({ ...condition, eventDays: event.target.value })}
            className="w-20"
          />
          {t('daysSuffix')}
        </span>
      )}

      {condition.target === 'score' && (
        <Input
          aria-label={t('value')}
          type="number"
          placeholder="0"
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          className="w-24"
        />
      )}

      {condition.target === 'prediction' && (
        <Input
          aria-label={t('value')}
          type="number"
          min={0}
          max={1}
          step={0.05}
          placeholder="0.5"
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          className="w-24"
        />
      )}

      {!isEvent &&
        condition.target !== 'score' &&
        condition.target !== 'prediction' &&
        !VALUELESS.has(condition.operator) &&
        (condition.target === 'status' ? (
          <ThemedSelect
            aria-label={t('value')}
            value={condition.value}
            onValueChange={(value) => onChange({ ...condition, value })}
            className="w-40"
            options={CONTACT_STATUSES.map((status) => ({
              value: status,
              label: t(`statuses.${status}`),
            }))}
          />
        ) : condition.target === 'created_at' ? (
          condition.operator === 'in_last_days' ? (
            <Input
              aria-label={t('value')}
              type="number"
              min={1}
              placeholder={t('daysPlaceholder')}
              value={condition.value}
              onChange={(event) => onChange({ ...condition, value: event.target.value })}
              className="w-28"
            />
          ) : (
            <Input
              aria-label={t('value')}
              type="date"
              value={condition.value}
              onChange={(event) => onChange({ ...condition, value: event.target.value })}
              className="w-40"
            />
          )
        ) : (
          <Input
            aria-label={t('value')}
            placeholder={t('valuePlaceholder')}
            value={condition.value}
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
            className="w-44"
          />
        ))}

      <Button variant="ghost" size="icon" aria-label={t('removeCondition')} onClick={onRemove}>
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
