'use client';

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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

/** Per-workspace conversion events for predictive scoring (C1 backend). */
export function AnalyticsPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('analyticsSettings');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [value, setValue] = useState<string | null>(null);

  const workspaces = useQuery({ ...trpc.workspace.list.queryOptions(), enabled: canManage });
  const save = useMutation(trpc.workspace.setConversionEvents.mutationOptions());

  if (!canManage) return null;
  const workspace = workspaces.data?.find((entry) => entry.id === workspaceId);
  const stored = Array.isArray(workspace?.conversionEvents)
    ? (workspace.conversionEvents as string[]).join(', ')
    : '';

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const events = (value ?? stored)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    try {
      await save.mutateAsync({ workspaceId, events });
      await queryClient.invalidateQueries(trpc.workspace.list.pathFilter());
      setValue(null);
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Card data-testid="analytics-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4" aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={onSave}>
          <div className="grid gap-1.5">
            <Label htmlFor="conversion-events">{t('label')}</Label>
            <Input
              id="conversion-events"
              placeholder={t('placeholder')}
              value={value ?? stored}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div>
            <Button type="submit" disabled={save.isPending || !workspaceId}>
              {t('save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
