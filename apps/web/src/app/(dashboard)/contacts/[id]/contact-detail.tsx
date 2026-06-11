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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ContactDialog } from '@/components/contacts/contact-dialog';
import { useTRPC } from '@/trpc/client';

/**
 * The contact detail page (H2): profile + traits, predictions, list
 * memberships, deals, tasks, notes, and the unified timeline. Behavioral
 * events ride along when the analytics store is up; without it the page
 * says so in one quiet line and stays fully useful.
 */
export function ContactDetail({ contactId }: { contactId: string }) {
  const t = useTranslations('contactDetail');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [noteBody, setNoteBody] = useState('');

  const contact = useQuery(trpc.contact.get.queryOptions({ id: contactId }));
  const timeline = useQuery(trpc.contact.timeline.queryOptions({ id: contactId }));
  const createNote = useMutation(trpc.crm.createNote.mutationOptions());
  const pinNote = useMutation(trpc.crm.setNotePinned.mutationOptions());
  const deleteNote = useMutation(trpc.crm.deleteNote.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries(trpc.contact.get.pathFilter());
    await queryClient.invalidateQueries(trpc.contact.timeline.pathFilter());
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const data = contact.data;
  if (contact.isLoading) {
    return <p className="text-muted-foreground text-sm">{t('loading')}</p>;
  }
  if (!data) {
    return (
      <div className="grid gap-3">
        <p className="text-muted-foreground text-sm">{t('notFound')}</p>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/contacts">
              <ArrowLeft className="size-4" aria-hidden /> {t('back')}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || data.email;
  const traits = Object.entries((data.attributes ?? {}) as Record<string, string>);

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-4" data-testid="contact-detail">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/contacts" aria-label={t('back')}>
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="text-muted-foreground text-sm">{data.email}</p>
        </div>
        <Badge variant={data.status === 'ACTIVE' ? 'secondary' : 'outline'}>{data.status}</Badge>
        {data.company && <Badge variant="outline">{data.company.name}</Badge>}
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden /> {t('edit')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-testid="contact-scores">
          <CardHeader>
            <CardTitle>{t('scores')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('leadScore')}</span>
              <span>{data.score}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('conversion')}</span>
              <span>
                {data.conversionProbability === null
                  ? '—'
                  : `${Math.round(data.conversionProbability * 100)}%`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('churn')}</span>
              <span>{data.churnRisk === null ? '—' : `${Math.round(data.churnRisk * 100)}%`}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('bestHour')}</span>
              <span>{data.bestSendHour === null ? '—' : `${data.bestSendHour}:00`}</span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="contact-traits">
          <CardHeader>
            <CardTitle>{t('traits')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {traits.length === 0 && <p className="text-muted-foreground">{t('noTraits')}</p>}
            {traits.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <code className="text-muted-foreground text-xs">{key}</code>
                <span className="truncate">{String(value)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="contact-memberships">
          <CardHeader>
            <CardTitle>{t('lists')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {data.listMembers.length === 0 && (
              <p className="text-muted-foreground text-sm">{t('noLists')}</p>
            )}
            {data.listMembers.map((member) => (
              <Badge key={member.list.id} variant="outline">
                {member.list.name}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="contact-notes">
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
                    contactId: data.id,
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
                <li key={note.id} className="rounded-md border p-2" data-testid="contact-note">
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

        <div className="grid gap-4">
          <Card data-testid="contact-deals">
            <CardHeader>
              <CardTitle>{t('deals')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              {data.deals.length === 0 && <p className="text-muted-foreground">{t('noDeals')}</p>}
              {data.deals.map((deal) => (
                <div key={deal.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{deal.title}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      {(deal.valueCents / 100).toLocaleString(undefined, {
                        style: 'currency',
                        currency: deal.currency,
                      })}
                    </span>
                    <Badge variant="outline">{deal.status}</Badge>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card data-testid="contact-tasks">
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
      </div>

      <Card data-testid="contact-timeline">
        <CardHeader>
          <CardTitle>{t('timeline')}</CardTitle>
          <CardDescription>
            {timeline.data?.clickhouseUp === false ? t('timelineDegraded') : t('timelineHint')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(timeline.data?.entries ?? []).map((entry) => (
            <div key={`${entry.type}-${entry.id}`} className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground w-40 shrink-0 text-xs">
                {new Date(entry.at).toLocaleString()}
              </span>
              <Badge variant="outline">{t(`type.${entry.type}`)}</Badge>
              <span className="truncate">{entry.label}</span>
              {entry.detail && (
                <span className="text-muted-foreground text-xs">{entry.detail}</span>
              )}
            </div>
          ))}
          {(timeline.data?.entries ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm">{t('noActivity')}</p>
          )}
        </CardContent>
      </Card>

      <ContactDialog
        workspaceId={data.workspaceId}
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) void refresh();
        }}
        editing={{
          id: data.id,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
        }}
      />
    </div>
  );
}
