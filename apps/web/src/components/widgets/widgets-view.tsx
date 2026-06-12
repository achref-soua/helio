'use client';

import { WIDGET_TYPES, widgetEmbedSnippet, type WidgetType } from '@helio/core';
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
import { MousePointerClick, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { PreviewShell } from '@/components/preview-shell';
import { ThemedSelect } from '@/components/themed-select';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const FIELD_CLASS =
  'border-input bg-transparent dark:bg-input/30 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

interface EditingWidget {
  id: string;
  name: string;
  type: WidgetType;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

/** What the embed script will actually paint, miniaturized. */
function WidgetPreview({
  type,
  title,
  body,
  ctaLabel,
}: {
  type: WidgetType;
  title: string;
  body: string;
  ctaLabel: string;
}) {
  const t = useTranslations('widgets');
  const message = (
    <>
      <p className="text-[13px] leading-snug font-semibold">{title || t('previewTitleFallback')}</p>
      <p className="text-muted-foreground text-xs leading-snug">
        {body || t('previewBodyFallback')}
      </p>
      {ctaLabel && (
        <span className="bg-primary text-primary-foreground mt-1 w-fit rounded-md px-2.5 py-1 text-xs font-medium">
          {ctaLabel}
        </span>
      )}
    </>
  );
  return (
    <PreviewShell label={t('preview')} data-testid="widget-preview" className="p-0">
      {/* A miniature page so placement reads instantly. */}
      <div className="bg-background relative h-56 overflow-hidden rounded-lg">
        <div className="bg-muted/60 flex h-6 items-center gap-1.5 border-b px-2" aria-hidden>
          <span className="bg-border size-2 rounded-full" />
          <span className="bg-border size-2 rounded-full" />
          <span className="bg-border h-2.5 w-32 rounded-full" />
        </div>
        {type === 'BANNER' ? (
          <div className="bg-card grid gap-1 border-b p-3 shadow-sm">{message}</div>
        ) : (
          <div className="absolute inset-x-0 top-6 bottom-0 grid place-items-center bg-black/30 p-4">
            <div className="bg-card grid w-full max-w-60 gap-1 rounded-lg border p-3 shadow-lg">
              {message}
            </div>
          </div>
        )}
      </div>
    </PreviewShell>
  );
}

export function WidgetsView() {
  const t = useTranslations('widgets');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditingWidget | null>(null);
  // Controlled mirror of the dialog fields so the preview tracks typing.
  const [draft, setDraft] = useState({
    type: 'BANNER' as WidgetType,
    title: '',
    body: '',
    ctaLabel: '',
  });

  const list = useQuery({
    ...trpc.widget.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  const create = useMutation(trpc.widget.create.mutationOptions());
  const update = useMutation(trpc.widget.update.mutationOptions());
  const remove = useMutation(trpc.widget.remove.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.widget.list.pathFilter());

  function openCreate() {
    setEditing(null);
    setDraft({ type: 'BANNER', title: '', body: '', ctaLabel: '' });
    setOpen(true);
  }
  function openEdit(widget: EditingWidget) {
    setEditing(widget);
    setDraft({
      type: widget.type,
      title: widget.title,
      body: widget.body,
      ctaLabel: widget.ctaLabel ?? '',
    });
    setOpen(true);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = new FormData(event.currentTarget);
    const fields = {
      name: String(form.get('name') ?? '').trim(),
      type: String(form.get('type') ?? 'BANNER') as WidgetType,
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

  function copySnippet() {
    const snippet = widgetEmbedSnippet(`${window.location.origin}/widget.js`, 'YOUR_WRITE_KEY');
    void navigator.clipboard?.writeText(snippet);
    toast.success(t('snippetCopied'));
  }

  if (!workspaceId || list.isLoading) {
    return <Skeleton className="h-72" data-testid="widgets-loading" />;
  }

  const rows = list.data ?? [];

  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex items-center gap-2">
        <MousePointerClick className="text-primary size-5" aria-hidden />
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <Button size="sm" className="ml-auto" onClick={openCreate} data-testid="widget-new">
          <Plus aria-hidden /> {t('new')}
        </Button>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">{t('subtitle')}</p>

      {rows.length === 0 ? (
        <Card data-testid="widgets-empty">
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((widget) => (
            <li
              key={widget.id}
              className="bg-background grid content-start gap-3 rounded-lg border p-3 text-sm"
              data-testid="widget-row"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium">{widget.name}</span>
                <Badge variant="outline" className="capitalize">
                  {t(`types.${widget.type}`)}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => onToggle(widget.id, widget.active)}
                  data-testid="widget-toggle"
                >
                  <Badge variant={widget.active ? 'secondary' : 'outline'}>
                    {widget.active ? t('active') : t('inactive')}
                  </Badge>
                </Button>
                <div className="ml-auto flex gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('editLabel', { name: widget.name })}
                    onClick={() => openEdit(widget)}
                    data-testid="widget-edit"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('removeLabel', { name: widget.name })}
                    onClick={() => onRemove(widget.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
              <WidgetPreview
                type={widget.type}
                title={widget.title}
                body={widget.body}
                ctaLabel={widget.ctaLabel ?? ''}
              />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardContent className="grid gap-2 py-4 text-sm">
          <span className="font-medium">{t('embedTitle')}</span>
          <p className="text-muted-foreground text-xs">{t('embedHint')}</p>
          <code className="bg-muted rounded px-3 py-2 text-xs break-all">
            {widgetEmbedSnippet(
              typeof window === 'undefined' ? '/widget.js' : `${window.location.origin}/widget.js`,
              'YOUR_WRITE_KEY',
            )}
          </code>
          <Button variant="outline" size="sm" className="w-fit" onClick={copySnippet}>
            {t('copySnippet')}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('newTitle')}</DialogTitle>
            <DialogDescription>{t('dialogSubtitle')}</DialogDescription>
          </DialogHeader>
          <div className="grid items-start gap-5 sm:grid-cols-[1fr_280px]">
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="widget-name">{t('name')}</Label>
                  <Input
                    id="widget-name"
                    name="name"
                    defaultValue={editing?.name}
                    required
                    maxLength={80}
                    data-testid="widget-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="widget-type">{t('type')}</Label>
                  <ThemedSelect
                    id="widget-type"
                    name="type"
                    value={draft.type}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, type: value as WidgetType }))
                    }
                    className="w-full"
                    options={WIDGET_TYPES.map((type) => ({
                      value: type,
                      label: t(`types.${type}`),
                    }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="widget-title">{t('messageTitle')}</Label>
                <Input
                  id="widget-title"
                  name="title"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  required
                  maxLength={160}
                  data-testid="widget-title"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="widget-body">{t('body')}</Label>
                <textarea
                  id="widget-body"
                  name="body"
                  value={draft.body}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, body: event.target.value }))
                  }
                  required
                  rows={2}
                  maxLength={1000}
                  className={FIELD_CLASS}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="widget-cta-label">{t('ctaLabel')}</Label>
                  <Input
                    id="widget-cta-label"
                    name="ctaLabel"
                    value={draft.ctaLabel}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, ctaLabel: event.target.value }))
                    }
                    maxLength={60}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="widget-cta-url">{t('ctaUrl')}</Label>
                  <Input
                    id="widget-cta-url"
                    name="ctaUrl"
                    type="url"
                    defaultValue={editing?.ctaUrl ?? ''}
                    placeholder="https://"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={create.isPending || update.isPending}
                  data-testid="widget-submit"
                >
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
            <WidgetPreview
              type={draft.type}
              title={draft.title}
              body={draft.body}
              ctaLabel={draft.ctaLabel}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
