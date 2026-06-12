'use client';

import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { PreviewShell } from '@/components/preview-shell';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const FIELD_CLASS =
  'border-input bg-transparent dark:bg-input/30 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

interface EditingMessage {
  id: string;
  name: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

export function InAppMessagesView() {
  const t = useTranslations('inApp');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditingMessage | null>(null);
  // Controlled mirror of the dialog fields so the preview tracks typing.
  const [draft, setDraft] = useState({ title: '', body: '', ctaLabel: '' });

  const list = useQuery({
    ...trpc.inAppMessage.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  const create = useMutation(trpc.inAppMessage.create.mutationOptions());
  const update = useMutation(trpc.inAppMessage.update.mutationOptions());
  const remove = useMutation(trpc.inAppMessage.remove.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.inAppMessage.list.pathFilter());

  function openCreate() {
    setEditing(null);
    setDraft({ title: '', body: '', ctaLabel: '' });
    setOpen(true);
  }
  function openEdit(message: EditingMessage) {
    setEditing(message);
    setDraft({
      title: message.title,
      body: message.body,
      ctaLabel: message.ctaLabel ?? '',
    });
    setOpen(true);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = new FormData(event.currentTarget);
    const fields = {
      name: String(form.get('name') ?? '').trim(),
      title: String(form.get('title') ?? '').trim(),
      body: String(form.get('body') ?? '').trim(),
      ctaLabel: String(form.get('ctaLabel') ?? '').trim() || undefined,
      ctaUrl: String(form.get('ctaUrl') ?? '').trim() || undefined,
    };
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          ...fields,
          ctaLabel: fields.ctaLabel ?? null,
          ctaUrl: fields.ctaUrl ?? null,
        });
      } else {
        await create.mutateAsync({ workspaceId, ...fields });
      }
      await invalidate();
      toast.success(t('saved'));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onToggle(id: string, active: boolean) {
    try {
      await update.mutateAsync({ id, active: !active });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onRemove(id: string) {
    try {
      await remove.mutateAsync({ id });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId || list.isLoading) {
    return <Skeleton className="h-72" data-testid="in-app-loading" />;
  }

  const rows = list.data ?? [];

  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex items-center gap-2">
        <AppWindow className="text-primary size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Button size="sm" className="ml-auto" onClick={openCreate} data-testid="in-app-new">
          <Plus aria-hidden /> {t('new')}
        </Button>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">{t('subtitle')}</p>

      {rows.length === 0 ? (
        <Card data-testid="in-app-empty">
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {rows.map((message) => (
            <li
              key={message.id}
              className="bg-background flex items-center gap-3 rounded-md border p-3 text-sm"
              data-testid="in-app-row"
            >
              <span className="font-medium">{message.name}</span>
              <span className="text-muted-foreground truncate">{message.title}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2"
                onClick={() => onToggle(message.id, message.active)}
                data-testid="in-app-toggle"
              >
                <Badge variant={message.active ? 'secondary' : 'outline'}>
                  {message.active ? t('active') : t('inactive')}
                </Badge>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('editLabel', { name: message.name })}
                onClick={() =>
                  openEdit({
                    id: message.id,
                    name: message.name,
                    title: message.title,
                    body: message.body,
                    ctaLabel: message.ctaLabel,
                    ctaUrl: message.ctaUrl,
                  })
                }
                data-testid="in-app-edit"
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('removeLabel', { name: message.name })}
                onClick={() => onRemove(message.id)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardContent className="text-muted-foreground py-4 text-xs">
          {t('deliveryHint')}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('createTitle')}</DialogTitle>
            <DialogDescription>{t('dialogHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid items-start gap-5 sm:grid-cols-[1fr_280px]">
            <form onSubmit={onSubmit} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="in-app-name">{t('fields.name')}</Label>
                <Input
                  id="in-app-name"
                  name="name"
                  required
                  defaultValue={editing?.name ?? ''}
                  data-testid="in-app-name"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="in-app-title">{t('fields.heading')}</Label>
                <Input
                  id="in-app-title"
                  name="title"
                  required
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  data-testid="in-app-title"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="in-app-body">{t('fields.body')}</Label>
                <textarea
                  id="in-app-body"
                  name="body"
                  required
                  rows={3}
                  value={draft.body}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, body: event.target.value }))
                  }
                  className={FIELD_CLASS}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="in-app-cta-label">{t('fields.ctaLabel')}</Label>
                  <Input
                    id="in-app-cta-label"
                    name="ctaLabel"
                    value={draft.ctaLabel}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, ctaLabel: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="in-app-cta-url">{t('fields.ctaUrl')}</Label>
                  <Input
                    id="in-app-cta-url"
                    name="ctaUrl"
                    type="url"
                    placeholder="https://"
                    defaultValue={editing?.ctaUrl ?? ''}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="in-app-submit">
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
            <PreviewShell label={t('preview')} data-testid="in-app-preview">
              {/* The SDK paints this as a corner toast inside the host app. */}
              <div className="bg-card grid gap-1 rounded-lg border p-3 shadow-lg">
                <p className="text-[13px] leading-snug font-semibold">
                  {draft.title || t('previewTitleFallback')}
                </p>
                <p className="text-muted-foreground text-xs leading-snug">
                  {draft.body || t('previewBodyFallback')}
                </p>
                {draft.ctaLabel && (
                  <span className="bg-primary text-primary-foreground mt-1 w-fit rounded-md px-2.5 py-1 text-xs font-medium">
                    {draft.ctaLabel}
                  </span>
                )}
              </div>
            </PreviewShell>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
