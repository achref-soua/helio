'use client';

import { resolvePalette, type SurfacePalette } from '@helio/core';
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
import { ClipboardCopy, Eye, FileText, Palette, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { PaletteFields } from '@/components/palette-fields';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

export function FormsView() {
  const t = useTranslations('forms');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  // The hosted page itself, framed — zero drift from what visitors see.
  const [previewId, setPreviewId] = useState<string | null>(null);
  // The form whose palette is being themed, and the working draft.
  const [customizeId, setCustomizeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SurfacePalette | null>(null);

  const formsQuery = useQuery({
    ...trpc.form.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  // The org brand color seeds palette defaults for forms not yet themed.
  const brandingQuery = useQuery(trpc.branding.get.queryOptions());
  const brandColor = brandingQuery.data?.brandColor ?? null;
  const createForm = useMutation(trpc.form.create.mutationOptions());
  const updateForm = useMutation(trpc.form.update.mutationOptions());
  const deleteForm = useMutation(trpc.form.delete.mutationOptions());
  const invalidate = () => queryClient.invalidateQueries(trpc.form.list.pathFilter());

  function toggleCustomize(form: { id: string; palette: unknown }) {
    if (customizeId === form.id) {
      setCustomizeId(null);
      setDraft(null);
    } else {
      setCustomizeId(form.id);
      setDraft(resolvePalette(form.palette, brandColor));
    }
  }

  async function onSavePalette(id: string) {
    if (!draft) return;
    try {
      await updateForm.mutateAsync({ id, palette: draft });
      await invalidate();
      toast.success(t('paletteSaved'));
      setCustomizeId(null);
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    try {
      await createForm.mutateAsync({ workspaceId, name: name.trim(), title: title.trim() });
      await invalidate();
      toast.success(t('created'));
      setCreateOpen(false);
      setName('');
      setTitle('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteForm.mutateAsync({ id });
      await invalidate();
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  function copyLink(id: string) {
    void navigator.clipboard.writeText(`${window.location.origin}/f/${id}`);
    toast.success(t('linkCopied'));
  }

  if (!workspaceId) {
    return <Skeleton className="h-64" data-testid="forms-loading" />;
  }

  const forms = formsQuery.data ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <Badge variant="outline">{t('total', { count: forms.length })}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> {t('newForm')}
          </Button>
        </div>
      </div>

      {createOpen && (
        <Card data-testid="form-create">
          <CardHeader>
            <CardTitle>{t('createTitle')}</CardTitle>
            <CardDescription>{t('createSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="grid max-w-xl gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="form-name">{t('name')}</Label>
                <Input
                  id="form-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="form-title">{t('formTitle')}</Label>
                <Input
                  id="form-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={createForm.isPending}>
                  {t('createAction')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {formsQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : forms.length === 0 && !createOpen ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-base font-medium">{t('emptyTitle')}</CardTitle>
              <CardDescription>{t('emptyBody')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          forms.map((form) => (
            <Card key={form.id} data-testid="form-card">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{form.name}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('deleteAction', { name: form.name })}
                    onClick={() => onDelete(form.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                <CardDescription className="flex items-center gap-1">
                  <FileText className="size-3.5" aria-hidden /> {form.title}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {/* The hosted path gets its own full-width row and wraps
                    (break-all) so the whole link is always visible — never
                    clipped — however long the slug or however narrow the card. */}
                <code
                  className="text-muted-foreground bg-muted/60 block rounded-md px-2.5 py-1.5 text-xs break-all"
                  data-testid="form-path"
                >
                  /f/{form.id}
                </code>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewId(previewId === form.id ? null : form.id)}
                    data-testid="form-preview-toggle"
                  >
                    <Eye aria-hidden /> {previewId === form.id ? t('hidePreview') : t('preview')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyLink(form.id)}
                    aria-label={t('copyLink', { name: form.name })}
                  >
                    <ClipboardCopy aria-hidden /> {t('copy')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleCustomize(form)}
                    data-testid="form-customize-toggle"
                  >
                    <Palette aria-hidden />{' '}
                    {customizeId === form.id ? t('hideColors') : t('colors')}
                  </Button>
                </div>
                {customizeId === form.id && draft && (
                  <div
                    className="grid gap-3 rounded-md border p-3"
                    data-testid="form-palette-editor"
                  >
                    <p className="text-muted-foreground text-xs">{t('colorsHint')}</p>
                    <PaletteFields value={draft} onChange={setDraft} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => onSavePalette(form.id)}
                        disabled={updateForm.isPending}
                      >
                        {t('saveColors')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCustomizeId(null);
                          setDraft(null);
                        }}
                      >
                        {t('cancel')}
                      </Button>
                    </div>
                  </div>
                )}
                {previewId === form.id && (
                  <iframe
                    title={t('preview')}
                    src={`/f/${form.id}`}
                    className="bg-background h-72 w-full rounded-md border"
                    data-testid="form-preview"
                  />
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
