'use client';

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helio/ui/components/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Handshake, Plus, SquareKanban, Table2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ThemedSelect } from '@/components/themed-select';
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

function DroppableColumn({
  stageId,
  children,
  ...rest
}: {
  stageId: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div ref={setNodeRef} {...rest} data-over={isOver ? 'true' : undefined}>
      {children}
    </div>
  );
}

function DragHandle({ dealId, title }: { dealId: string; title: string }) {
  // The handle alone is draggable so links, selects, and checkboxes inside
  // the card keep working; keyboard users move deals via the stage select.
  const { attributes, listeners, setNodeRef } = useDraggable({ id: dealId });
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`Drag ${title}`}
      className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none"
      {...listeners}
      {...attributes}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}

export function DealsView() {
  const t = useTranslations('deals');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [createOpen, setCreateOpen] = useState(false);
  // Board and table are two views of the same pipeline; the choice
  // persists per browser. Read after hydration paints (same pattern as
  // the sidebar preference).
  const [view, setView] = useState<'board' | 'table'>('board');
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (localStorage.getItem('helio.deals.view') === 'table') setView('table');
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  function switchView(next: 'board' | 'table') {
    setView(next);
    localStorage.setItem('helio.deals.view', next);
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState('');
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
  const moveDeals = useMutation(trpc.crm.moveDeals.mutationOptions());
  // A small drag threshold keeps plain clicks (links, selects) working.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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

  function onDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id);
    const stageId = event.over ? String(event.over.id) : null;
    if (!stageId) return;
    void onMove(dealId, stageId);
  }

  function toggleSelected(dealId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }

  async function onBulkMove() {
    if (!bulkStage || selected.size === 0) return;
    try {
      await moveDeals.mutateAsync({ ids: [...selected], stageId: bulkStage });
      setSelected(new Set());
      setBulkStage('');
      await invalidate();
      toast.success(t('bulkMoved', { count: selected.size }));
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
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="ml-auto flex gap-2">
          <div
            className="flex items-center gap-0.5 rounded-md border p-0.5"
            role="group"
            aria-label={t('viewLabel')}
          >
            <Button
              size="icon-sm"
              variant={view === 'board' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'board'}
              aria-label={t('viewBoard')}
              onClick={() => switchView('board')}
              data-testid="deals-view-board"
            >
              <SquareKanban aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant={view === 'table' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'table'}
              aria-label={t('viewTable')}
              onClick={() => switchView('table')}
              data-testid="deals-view-table"
            >
              <Table2 aria-hidden />
            </Button>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/deals/reports">{t('reports')}</Link>
          </Button>
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
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {selected.size > 0 && (
            <div
              className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-2"
              data-testid="bulk-bar"
            >
              <span className="text-sm">{t('bulkSelected', { count: selected.size })}</span>
              <ThemedSelect
                aria-label={t('bulkStageLabel')}
                value={bulkStage}
                onValueChange={setBulkStage}
                size="sm"
                placeholder={t('bulkStagePlaceholder')}
                options={board.stages.map((option) => ({ value: option.id, label: option.name }))}
              />
              <Button size="sm" onClick={onBulkMove} disabled={!bulkStage || moveDeals.isPending}>
                {t('bulkMove')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('bulkClear')}
              </Button>
            </div>
          )}
          {view === 'table' && board.stages.some((stage) => stage.deals.length > 0) && (
            <DealsTable
              board={board}
              selected={selected}
              onToggle={toggleSelected}
              onMove={onMove}
              onDelete={onDelete}
            />
          )}
          {view === 'table' && !board.stages.some((stage) => stage.deals.length > 0) && (
            <p className="text-muted-foreground py-8 text-center text-sm">{t('tableEmpty')}</p>
          )}
          <div
            className={view === 'board' ? 'flex gap-3 overflow-x-auto pb-2' : 'hidden'}
            data-testid="deal-board"
          >
            {board.stages.map((stage) => {
              const openValue = stage.deals.reduce(
                (sum, deal) => (deal.status === 'OPEN' ? sum + deal.valueCents : sum),
                0,
              );
              const currency = stage.deals[0]?.currency ?? 'USD';
              return (
                <DroppableColumn
                  key={stage.id}
                  stageId={stage.id}
                  className="bg-muted/30 data-[over=true]:ring-primary/40 grid w-72 shrink-0 content-start gap-2 rounded-md border p-2 data-[over=true]:ring-2"
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
                      <div className="flex items-center gap-1.5">
                        <DragHandle dealId={deal.id} title={deal.title} />
                        <input
                          type="checkbox"
                          className="accent-primary size-3.5"
                          aria-label={t('selectDeal', { title: deal.title })}
                          checked={selected.has(deal.id)}
                          onChange={() => toggleSelected(deal.id)}
                        />
                        <Link
                          href={`/deals/${deal.id}`}
                          className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                        >
                          {deal.title}
                        </Link>
                      </div>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {formatMoney(deal.valueCents, deal.currency)}
                      </span>
                      {deal.contact?.email && (
                        <span className="text-muted-foreground truncate text-xs">
                          {deal.contact.email}
                        </span>
                      )}
                      <div className="flex items-center gap-1">
                        <ThemedSelect
                          aria-label={t('moveTo', { title: deal.title })}
                          value={stage.id}
                          onValueChange={(next) => onMove(deal.id, next)}
                          className="grow"
                          size="sm"
                          options={board.stages.map((option) => ({
                            value: option.id,
                            label: option.name,
                          }))}
                        />
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
                </DroppableColumn>
              );
            })}
          </div>
        </DndContext>
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
              <ThemedSelect
                id="deal-stage"
                className="w-full"
                value={stageId || board?.stages[0]?.id}
                onValueChange={setStageId}
                options={(board?.stages ?? []).map((stage) => ({
                  value: stage.id,
                  label: stage.name,
                }))}
              />
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

interface TableBoard {
  stages: Array<{
    id: string;
    name: string;
    kind: string;
    deals: Array<{
      id: string;
      title: string;
      valueCents: number;
      currency: string;
      status: string;
      contact?: { email: string | null } | null;
    }>;
  }>;
}

/** The same pipeline as a flat, scannable table — one row per deal in
 *  stage order, with inline stage moves and the open total up top. */
function DealsTable({
  board,
  selected,
  onToggle,
  onMove,
  onDelete,
}: {
  board: TableBoard;
  selected: Set<string>;
  onToggle: (dealId: string) => void;
  onMove: (dealId: string, stageId: string) => void;
  onDelete: (dealId: string) => void;
}) {
  const t = useTranslations('deals');
  const rows = board.stages.flatMap((stage) => stage.deals.map((deal) => ({ stage, deal })));
  const openTotal = rows.reduce(
    (sum, { deal }) => (deal.status === 'OPEN' ? sum + deal.valueCents : sum),
    0,
  );
  const currency = rows[0]?.deal.currency ?? 'USD';
  const stageOptions = board.stages.map((option) => ({ value: option.id, label: option.name }));

  return (
    <div className="grid gap-2" data-testid="deal-table">
      <p className="text-muted-foreground text-xs">
        {t('tableSummary', { count: rows.length, total: formatMoney(openTotal, currency) })}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{t('columns.deal')}</TableHead>
            <TableHead>{t('columns.stage')}</TableHead>
            <TableHead className="text-right">{t('columns.value')}</TableHead>
            <TableHead>{t('columns.contact')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ stage, deal }) => (
            <TableRow key={deal.id} data-testid="deal-row">
              <TableCell>
                <input
                  type="checkbox"
                  className="accent-primary size-3.5"
                  aria-label={t('selectDeal', { title: deal.title })}
                  checked={selected.has(deal.id)}
                  onChange={() => onToggle(deal.id)}
                />
              </TableCell>
              <TableCell>
                <Link
                  href={`/deals/${deal.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {deal.title}
                </Link>
              </TableCell>
              <TableCell>
                <ThemedSelect
                  aria-label={t('moveTo', { title: deal.title })}
                  value={stage.id}
                  onValueChange={(next) => onMove(deal.id, next)}
                  size="sm"
                  options={stageOptions}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(deal.valueCents, deal.currency)}
              </TableCell>
              <TableCell className="text-muted-foreground">{deal.contact?.email ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={STAGE_TONE[stage.kind] ?? 'outline'}>{stage.name}</Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('deleteDeal', { title: deal.title })}
                  onClick={() => onDelete(deal.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
