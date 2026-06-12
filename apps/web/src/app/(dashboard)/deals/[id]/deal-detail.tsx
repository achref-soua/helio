'use client';

import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

/**
 * The deal detail page (H3): value and stage at a glance, owner
 * assignment, won/lost with an optional reason (recorded in the audit
 * trail), linked contact and company, tasks, team notes, and the deal's
 * full history.
 */
export function DealDetail({ dealId }: { dealId: string }) {
  const t = useTranslations('dealDetail');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [noteBody, setNoteBody] = useState('');
  const [closing, setClosing] = useState<'WON' | 'LOST' | null>(null);
  const [reason, setReason] = useState('');

  const deal = useQuery(trpc.crm.getDeal.queryOptions({ id: dealId }));
  const history = useQuery(trpc.crm.dealHistory.queryOptions({ id: dealId }));
  const members = useQuery(trpc.crm.members.queryOptions());
  const companies = useQuery({
    ...trpc.crm.companies.queryOptions({ workspaceId: deal.data?.workspaceId ?? '' }),
    enabled: Boolean(deal.data?.workspaceId),
  });
  const setCompany = useMutation(trpc.crm.setDealCompany.mutationOptions());
  const setOwner = useMutation(trpc.crm.setDealOwner.mutationOptions());
  const setStatus = useMutation(trpc.crm.setDealStatus.mutationOptions());
  const moveDeal = useMutation(trpc.crm.moveDeal.mutationOptions());
  const createNote = useMutation(trpc.crm.createNote.mutationOptions());
  const pinNote = useMutation(trpc.crm.setNotePinned.mutationOptions());
  const deleteNote = useMutation(trpc.crm.deleteNote.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries(trpc.crm.getDeal.pathFilter());
    await queryClient.invalidateQueries(trpc.crm.dealHistory.pathFilter());
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const data = deal.data;
  if (deal.isLoading) return <p className="text-muted-foreground text-sm">{t('loading')}</p>;
  if (!data) {
    return (
      <div className="grid gap-3">
        <p className="text-muted-foreground text-sm">{t('notFound')}</p>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/deals">
              <ArrowLeft className="size-4" aria-hidden /> {t('back')}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const money = (data.valueCents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: data.currency,
  });
  const contactName = data.contact
    ? [data.contact.firstName, data.contact.lastName].filter(Boolean).join(' ') ||
      data.contact.email
    : null;

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-4" data-testid="deal-detail">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/deals" aria-label={t('back')}>
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl font-semibold tracking-tight">
            {data.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {data.pipeline.name} · {money}
          </p>
        </div>
        <Badge
          variant={
            data.status === 'WON' ? 'default' : data.status === 'LOST' ? 'destructive' : 'secondary'
          }
          data-testid="deal-status"
        >
          {t(`status.${data.status}`)}
        </Badge>
        <div className="ml-auto flex gap-2">
          {data.status === 'OPEN' ? (
            <>
              <Button size="sm" onClick={() => setClosing('WON')}>
                {t('markWon')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setClosing('LOST')}>
                {t('markLost')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => setStatus.mutateAsync({ id: data.id, status: 'OPEN' }))}
            >
              {t('reopen')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-testid="deal-meta">
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('stage')}</span>
              <select
                aria-label={t('stage')}
                className="border-input bg-background h-9 rounded-md border px-2"
                value={data.stageId}
                onChange={(event) =>
                  run(() =>
                    moveDeal.mutateAsync({
                      id: data.id,
                      stageId: event.target.value,
                      position: 0,
                    }),
                  )
                }
              >
                {data.pipeline.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('owner')}</span>
              <select
                aria-label={t('owner')}
                className="border-input bg-background h-9 rounded-md border px-2"
                value={data.ownerId ?? ''}
                onChange={(event) =>
                  run(() =>
                    setOwner.mutateAsync({ id: data.id, ownerId: event.target.value || null }),
                  )
                }
              >
                <option value="">{t('unassigned')}</option>
                {(members.data ?? []).map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            {data.closedAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('closedAt')}</span>
                <span>{new Date(data.closedAt).toLocaleDateString()}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="deal-links">
          <CardHeader>
            <CardTitle>{t('linked')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('contact')}</span>
              {data.contact ? (
                <Link
                  href={`/contacts/${data.contact.id}`}
                  className="truncate underline-offset-4 hover:underline"
                >
                  {contactName}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('company')}</span>
              <select
                aria-label={t('company')}
                className="border-input bg-background h-9 rounded-md border px-2"
                value={data.companyId ?? ''}
                onChange={(event) =>
                  run(() =>
                    setCompany.mutateAsync({
                      dealId: data.id,
                      companyId: event.target.value || null,
                    }),
                  )
                }
              >
                <option value="">{t('noCompany')}</option>
                {(companies.data ?? []).map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
          </CardContent>
        </Card>

        <Card data-testid="deal-tasks">
          <CardHeader>
            <CardTitle>{t('tasks')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {data.tasks.length === 0 && <p className="text-muted-foreground">{t('noTasks')}</p>}
            {data.tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-2">
                <span
                  className={task.status === 'DONE' ? 'text-muted-foreground line-through' : ''}
                >
                  {task.title}
                </span>
                <span className="text-muted-foreground text-xs">
                  {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="deal-notes">
          <CardHeader>
            <CardTitle>{t('notes')}</CardTitle>
            <CardDescription>{t('notesHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!noteBody.trim()) return;
                void run(async () => {
                  await createNote.mutateAsync({
                    workspaceId: data.workspaceId,
                    dealId: data.id,
                    body: noteBody,
                  });
                  setNoteBody('');
                });
              }}
            >
              <textarea
                aria-label={t('noteLabel')}
                className="border-input bg-background min-h-16 rounded-md border p-2 text-sm"
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                maxLength={4000}
              />
              <div>
                <Button type="submit" size="sm" disabled={createNote.isPending}>
                  {t('addNote')}
                </Button>
              </div>
            </form>
            <ul className="grid gap-2">
              {data.notes.map((note) => (
                <li key={note.id} className="rounded-md border p-2" data-testid="deal-note">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={note.pinned ? t('unpin') : t('pin')}
                        onClick={() =>
                          run(() => pinNote.mutateAsync({ id: note.id, pinned: !note.pinned }))
                        }
                      >
                        {note.pinned ? (
                          <Pin className="text-primary size-4" aria-hidden />
                        ) : (
                          <PinOff className="size-4" aria-hidden />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('deleteNote')}
                        onClick={() => run(() => deleteNote.mutateAsync({ id: note.id }))}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {note.author ?? '—'} · {new Date(note.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card data-testid="deal-history">
          <CardHeader>
            <CardTitle>{t('history')}</CardTitle>
            <CardDescription>{t('historyHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {(history.data ?? []).map((entry) => (
              <div key={entry.id} className="flex items-start gap-3">
                <span className="text-muted-foreground w-36 shrink-0 text-xs">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                <div className="min-w-0">
                  <p>
                    <code className="text-xs">{entry.action}</code>
                    <span className="text-muted-foreground"> · {entry.actor ?? '—'}</span>
                  </p>
                  {entry.metadata && typeof entry.metadata.reason === 'string' && (
                    <p className="text-muted-foreground text-xs">“{entry.metadata.reason}”</p>
                  )}
                </div>
              </div>
            ))}
            {(history.data ?? []).length === 0 && (
              <p className="text-muted-foreground">{t('noHistory')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{closing === 'WON' ? t('markWon') : t('markLost')}</DialogTitle>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span>{t('reasonLabel')}</span>
            <textarea
              aria-label={t('reasonLabel')}
              className="border-input bg-background min-h-16 rounded-md border p-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
            />
          </label>
          <DialogFooter>
            <Button
              onClick={() => {
                const status = closing;
                if (!status) return;
                void run(async () => {
                  await setStatus.mutateAsync({
                    id: data.id,
                    status,
                    reason: reason.trim() || undefined,
                  });
                  setClosing(null);
                  setReason('');
                });
              }}
              disabled={setStatus.isPending}
            >
              {t('confirmClose')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
