'use client';

import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { cn } from '@helio/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const STAGE_TONE: Record<string, 'secondary' | 'outline'> = {
  WON: 'secondary',
  LOST: 'outline',
  OPEN: 'outline',
};

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** A keyboard- and screen-reader-friendly native select. */
function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'border-input bg-transparent dark:bg-input/30 h-8 rounded-md border px-2 text-xs shadow-xs outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        className,
      )}
      {...props}
    />
  );
}

export function DealsView() {
  const t = useTranslations('deals');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState('');

  const boardQuery = useQuery({
    ...trpc.crm.board.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });

  const createPipeline = useMutation(trpc.crm.createPipeline.mutationOptions());
  const createDeal = useMutation(trpc.crm.createDeal.mutationOptions());
  const moveDeal = useMutation(trpc.crm.moveDeal.mutationOptions());
  const deleteDeal = useMutation(trpc.crm.deleteDeal.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.crm.board.pathFilter());

  async function onCreatePipeline() {
    if (!workspaceId) return;
    try {
      await createPipeline.mutateAsync({ workspaceId, name: t('defaultPipelineName') });
      await invalidate();
      toast.success(t('pipelineCreated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onCreateDeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const board = boardQuery.data;
    if (!workspaceId || !board || !title.trim()) return;
    const targetStage = stageId || board.stages[0]?.id;
    if (!targetStage) return;
    const dollars = Number(value);
    try {
      await createDeal.mutateAsync({
        workspaceId,
        pipelineId: board.id,
        stageId: targetStage,
        title: title.trim(),
        valueCents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0,
      });
      await invalidate();
      toast.success(t('dealCreated'));
      setCreateOpen(false);
      setTitle('');
      setValue('');
      setStageId('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onMove(dealId: string, toStageId: string) {
    try {
      // Append to the destination column (position 0 keeps it simple and
      // the server re-reads order; a precise index isn't needed here).
      await moveDeal.mutateAsync({ id: dealId, stageId: toStageId, position: 0 });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onDelete(dealId: string) {
    try {
      await deleteDeal.mutateAsync({ id: dealId });
      await invalidate();
      toast.success(t('dealDeleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId || boardQuery.isLoading) {
    return <Skeleton className="h-72" data-testid="deals-loading" />;
  }

  const board = boardQuery.data;

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Handshake className="text-primary size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="ml-auto">
          {board && (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="new-deal">
              <Plus aria-hidden /> {t('newDeal')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">{t('subtitle')}</p>

      {!board ? (
        <Card data-testid="deals-empty">
          <CardHeader>
            <CardTitle className="text-base">{t('emptyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4 text-sm">{t('emptyBody')}</p>
            <Button onClick={onCreatePipeline} disabled={createPipeline.isPending}>
              <Plus aria-hidden /> {t('createPipeline')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="deal-board">
          {board.stages.map((stage) => {
            const openValue = stage.deals.reduce(
              (sum, deal) => (deal.status === 'OPEN' ? sum + deal.valueCents : sum),
              0,
            );
            const currency = stage.deals[0]?.currency ?? 'USD';
            return (
              <div
                key={stage.id}
                className="bg-muted/30 grid w-72 shrink-0 content-start gap-2 rounded-md border p-2"
                data-testid={`stage-${stage.kind.toLowerCase()}`}
                aria-label={stage.name}
              >
                <div className="flex items-center justify-between px-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {stage.name}
                    <Badge variant={STAGE_TONE[stage.kind]}>{stage.deals.length}</Badge>
                  </span>
                  {openValue > 0 && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatMoney(openValue, currency)}
                    </span>
                  )}
                </div>

                {stage.deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="bg-background grid gap-2 rounded-md border p-2 text-sm shadow-xs"
                    data-testid="deal-card"
                  >
                    <span className="font-medium">{deal.title}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatMoney(deal.valueCents, deal.currency)}
                    </span>
                    {deal.contact?.email && (
                      <span className="text-muted-foreground truncate text-xs">
                        {deal.contact.email}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <Select
                        aria-label={t('moveTo', { title: deal.title })}
                        value={stage.id}
                        onChange={(event) => onMove(deal.id, event.target.value)}
                        className="grow"
                      >
                        {board.stages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={t('deleteDeal', { title: deal.title })}
                        onClick={() => onDelete(deal.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newDeal')}</DialogTitle>
            <DialogDescription>{t('newDealSubtitle')}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={onCreateDeal}>
            <div className="grid gap-2">
              <Label htmlFor="deal-title">{t('dealTitle')}</Label>
              <Input
                id="deal-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deal-value">{t('dealValue')}</Label>
              <Input
                id="deal-value"
                type="number"
                min={0}
                step="0.01"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deal-stage">{t('dealStage')}</Label>
              <Select
                id="deal-stage"
                className="h-9 text-sm"
                value={stageId || board?.stages[0]?.id || ''}
                onChange={(event) => setStageId(event.target.value)}
              >
                {board?.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createDeal.isPending || !title.trim()}>
                {t('createDeal')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {t('cancel')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
