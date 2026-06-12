'use client';

import type { JourneyDefinition } from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Skeleton } from '@helio/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Plus, Trash2, Workflow } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

// React Flow and its node editors are the heaviest chunk in the app;
// loading them only when a journey opens keeps the list page light.
const JourneyEditor = dynamic(() => import('./journey-editor').then((mod) => mod.JourneyEditor), {
  ssr: false,
  loading: () => <Skeleton className="h-96" />,
});

const STATUS_VARIANT = { DRAFT: 'outline', ACTIVE: 'secondary', PAUSED: 'outline' } as const;

export function JourneysView() {
  const t = useTranslations('journeys');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorDefinition, setEditorDefinition] = useState<JourneyDefinition | null>(null);

  const journeysQuery = useQuery({
    ...trpc.journey.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });

  const createJourney = useMutation(trpc.journey.create.mutationOptions());
  const updateJourney = useMutation(trpc.journey.update.mutationOptions());
  const setStatus = useMutation(trpc.journey.setStatus.mutationOptions());
  const deleteJourney = useMutation(trpc.journey.delete.mutationOptions());
  const invalidate = () => queryClient.invalidateQueries(trpc.journey.list.pathFilter());

  function openCreate() {
    setEditingId(null);
    setEditorName('');
    setEditorDefinition(null);
    setEditorOpen(true);
  }

  async function openEdit(id: string) {
    const journey = await queryClient.fetchQuery(trpc.journey.get.queryOptions({ id }));
    setEditingId(id);
    setEditorName(journey.name);
    setEditorDefinition(journey.definition as unknown as JourneyDefinition);
    setEditorOpen(true);
  }

  async function onSave(name: string, definition: JourneyDefinition) {
    if (!workspaceId) return;
    try {
      if (editingId) {
        await updateJourney.mutateAsync({ id: editingId, name, definition });
      } else {
        await createJourney.mutateAsync({ workspaceId, name, definition });
      }
      await invalidate();
      toast.success(editingId ? t('updated') : t('created'));
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onToggle(id: string, status: 'ACTIVE' | 'PAUSED') {
    try {
      await setStatus.mutateAsync({ id, status });
      await invalidate();
      toast.success(status === 'ACTIVE' ? t('activated') : t('paused'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteJourney.mutateAsync({ id });
      await invalidate();
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId) {
    return <Skeleton className="h-64" data-testid="journeys-loading" />;
  }

  const journeys = journeysQuery.data ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <Badge variant="outline">{t('total', { count: journeys.length })}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> {t('newJourney')}
          </Button>
        </div>
      </div>

      {editorOpen && (
        <Card data-testid="journey-editor">
          <CardHeader>
            <CardTitle>{editingId ? t('editTitle') : t('createTitle')}</CardTitle>
            <CardDescription>{t('editorSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <JourneyEditor
              initialName={editorName}
              initialDefinition={editorDefinition}
              saving={createJourney.isPending || updateJourney.isPending}
              onSave={onSave}
              onCancel={() => setEditorOpen(false)}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {journeysQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : journeys.length === 0 && !editorOpen ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-base font-medium">{t('emptyTitle')}</CardTitle>
              <CardDescription>{t('emptyBody')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          journeys.map((journey) => {
            const definition = journey.definition as unknown as JourneyDefinition;
            return (
              <Card key={journey.id} data-testid="journey-card">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(journey.id)}
                      className="text-left"
                    >
                      <CardTitle className="text-base hover:underline">{journey.name}</CardTitle>
                    </button>
                    <Badge variant={STATUS_VARIANT[journey.status]}>
                      {t(`status.${journey.status}`)}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-1">
                    <Workflow className="size-3.5" aria-hidden />
                    {t('triggerSummary', {
                      event: definition.trigger?.event ?? '—',
                      steps: definition.nodes?.length ?? 0,
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground" data-testid="run-counts">
                    {t('runCounts', {
                      running: journey.runCounts.RUNNING ?? 0,
                      completed: journey.runCounts.COMPLETED ?? 0,
                    })}
                  </span>
                  <div className="ml-auto flex gap-1">
                    {journey.status === 'ACTIVE' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onToggle(journey.id, 'PAUSED')}
                        aria-label={t('pauseAction', { name: journey.name })}
                      >
                        <Pause aria-hidden /> {t('pause')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => onToggle(journey.id, 'ACTIVE')}
                        aria-label={t('activateAction', { name: journey.name })}
                      >
                        <Play aria-hidden /> {t('activate')}
                      </Button>
                    )}
                    {journey.status !== 'ACTIVE' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('deleteAction', { name: journey.name })}
                        onClick={() => onDelete(journey.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
