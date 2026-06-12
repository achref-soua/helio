'use client';

import { countConditions, type SegmentRule, type SegmentRuleGroup } from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { Plus, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

import {
  type DraftGroup,
  newDraftCondition,
  newDraftGroup,
  RuleGroupEditor,
  toSegmentRule,
} from './rule-builder';

interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  rule: unknown;
}

/** Rebuild an editable draft from a stored rule. */
function ruleToDraft(rule: SegmentRuleGroup): DraftGroup {
  const group = newDraftGroup();
  group.op = rule.op;
  group.children = rule.children.map((child) => {
    if (child.kind === 'group') return ruleToDraft(child);
    const draft = newDraftCondition();
    draft.target = child.target;
    draft.operator = child.operator;
    if (child.target === 'field') draft.field = child.field;
    if (child.target === 'attribute') draft.attributeKey = child.key;
    if (child.target === 'score') draft.value = String(child.value);
    if (child.target === 'prediction') {
      draft.predictionMetric = child.metric;
      draft.value = String(child.value);
    }
    if (child.target === 'event') {
      draft.eventName = child.event;
      draft.eventCount = String(child.count);
      draft.eventDays = String(child.inLastDays);
    }
    if ('value' in child) {
      draft.value =
        child.target === 'created_at' && typeof child.value === 'string'
          ? child.value.slice(0, 10) // date input format
          : String(child.value);
    }
    return draft;
  });
  return group;
}

export function SegmentsView() {
  const t = useTranslations('segments');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<DraftGroup>(() => newDraftGroup([newDraftCondition()]));

  const segmentsQuery = useQuery({
    ...trpc.segment.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });

  const rule = useMemo(() => toSegmentRule(draft), [draft]);
  const previewQuery = useQuery({
    ...trpc.segment.preview.queryOptions(
      { workspaceId: workspaceId ?? '', rule: rule as SegmentRule },
      { placeholderData: (previous) => previous },
    ),
    enabled: !!workspaceId && editorOpen && rule !== null,
    // Preconditions (analytics store offline, set too large) are stable
    // answers, not transient faults — retrying only delays the message.
    retry: (failureCount, error) =>
      failureCount < 2 &&
      !(error instanceof TRPCClientError && error.data?.code === 'PRECONDITION_FAILED'),
  });

  const createSegment = useMutation(trpc.segment.create.mutationOptions());
  const updateSegment = useMutation(trpc.segment.update.mutationOptions());
  const deleteSegment = useMutation(trpc.segment.delete.mutationOptions());
  const invalidate = () => queryClient.invalidateQueries(trpc.segment.list.pathFilter());

  function openCreate() {
    setEditingId(null);
    setName('');
    setDescription('');
    setDraft(newDraftGroup([newDraftCondition()]));
    setEditorOpen(true);
  }

  function openEdit(segment: SegmentRow) {
    setEditingId(segment.id);
    setName(segment.name);
    setDescription(segment.description ?? '');
    setDraft(ruleToDraft(segment.rule as SegmentRuleGroup));
    setEditorOpen(true);
  }

  async function onSave() {
    if (!workspaceId || !rule || !name.trim()) return;
    try {
      if (editingId) {
        await updateSegment.mutateAsync({
          id: editingId,
          name: name.trim(),
          description: description.trim() || null,
          rule,
        });
      } else {
        await createSegment.mutateAsync({
          workspaceId,
          name: name.trim(),
          description: description.trim() || undefined,
          rule,
        });
      }
      await invalidate();
      toast.success(editingId ? t('updated') : t('created'));
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteSegment.mutateAsync({ id });
      await invalidate();
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId) {
    return <Skeleton className="h-64" data-testid="segments-loading" />;
  }

  const segments = (segmentsQuery.data ?? []) as SegmentRow[];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <Badge variant="outline">{t('total', { count: segments.length })}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> {t('newSegment')}
          </Button>
        </div>
      </div>

      {editorOpen && (
        <Card data-testid="segment-editor">
          <CardHeader>
            <CardTitle>{editingId ? t('editTitle') : t('createTitle')}</CardTitle>
            <CardDescription>{t('editorSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="segment-name">{t('name')}</Label>
                <Input
                  id="segment-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="segment-description">{t('description')}</Label>
                <Input
                  id="segment-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                />
              </div>
            </div>

            <RuleGroupEditor group={draft} onChange={setDraft} />

            <div
              className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm"
              data-testid="segment-preview"
            >
              <Users className="size-4" aria-hidden />
              {rule === null
                ? t('previewIncomplete')
                : previewQuery.error
                  ? previewQuery.error.message
                  : previewQuery.data
                    ? t('previewCount', { count: previewQuery.data.count })
                    : t('previewLoading')}
              {!previewQuery.error &&
                previewQuery.data &&
                previewQuery.data.sample.length > 0 &&
                rule !== null && (
                  <span className="truncate">
                    — {previewQuery.data.sample.map((contact) => contact.email).join(', ')}
                  </span>
                )}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={onSave}
                disabled={
                  !name.trim() ||
                  rule === null ||
                  createSegment.isPending ||
                  updateSegment.isPending
                }
              >
                {editingId ? t('saveAction') : t('createAction')}
              </Button>
              <Button variant="ghost" onClick={() => setEditorOpen(false)}>
                {t('cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {segmentsQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : segments.length === 0 && !editorOpen ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-base font-medium">{t('emptyTitle')}</CardTitle>
              <CardDescription>{t('emptyBody')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          segments.map((segment) => (
            <SegmentCard
              key={segment.id}
              segment={segment}
              workspaceId={workspaceId}
              onEdit={() => openEdit(segment)}
              onDelete={() => onDelete(segment.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SegmentCard({
  segment,
  workspaceId,
  onEdit,
  onDelete,
}: {
  segment: SegmentRow;
  workspaceId: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('segments');
  const trpc = useTRPC();
  const countQuery = useQuery(
    trpc.segment.preview.queryOptions({ workspaceId, rule: segment.rule as SegmentRule }),
  );
  const conditions = countConditions(segment.rule as SegmentRuleGroup);

  return (
    <Card data-testid="segment-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={onEdit} className="text-left">
            <CardTitle className="text-base hover:underline">{segment.name}</CardTitle>
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('deleteAction', { name: segment.name })}
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
        {segment.description && <CardDescription>{segment.description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex items-center gap-2 text-sm">
        <Badge variant="secondary">
          {countQuery.data ? t('memberCount', { count: countQuery.data.count }) : '…'}
        </Badge>
        <span className="text-muted-foreground">{t('conditionCount', { count: conditions })}</span>
      </CardContent>
    </Card>
  );
}
