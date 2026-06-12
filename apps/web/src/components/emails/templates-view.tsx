'use client';

import type { EmailBlock, EmailDocument } from '@helio/core';
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
import { Mail, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

import { draftToDocument, newBlock, TemplateEditor } from './template-editor';

export function TemplatesView() {
  const t = useTranslations('emails');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);

  const templatesQuery = useQuery({
    ...trpc.emailTemplate.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });

  const createTemplate = useMutation(trpc.emailTemplate.create.mutationOptions());
  const updateTemplate = useMutation(trpc.emailTemplate.update.mutationOptions());
  const deleteTemplate = useMutation(trpc.emailTemplate.delete.mutationOptions());
  const getTemplate = useMutation(
    // get is a query, but we call it imperatively when opening the editor
    {
      mutationFn: (id: string) =>
        queryClient.fetchQuery(trpc.emailTemplate.get.queryOptions({ id })),
    },
  );
  const invalidate = () => queryClient.invalidateQueries(trpc.emailTemplate.list.pathFilter());

  function openCreate() {
    setEditingId(null);
    setName('');
    setSubject('');
    setBlocks([newBlock('heading'), newBlock('paragraph'), newBlock('button')]);
    setEditorOpen(true);
  }

  async function openEdit(id: string) {
    const template = await getTemplate.mutateAsync(id);
    setEditingId(id);
    setName(template.name);
    setSubject(template.subject);
    setBlocks((template.document as EmailDocument).blocks);
    setEditorOpen(true);
  }

  const document = draftToDocument(blocks);
  const savable = !!name.trim() && !!subject.trim() && document !== null;

  async function onSave() {
    if (!workspaceId || !document) return;
    try {
      if (editingId) {
        await updateTemplate.mutateAsync({
          id: editingId,
          name: name.trim(),
          subject: subject.trim(),
          document,
        });
      } else {
        await createTemplate.mutateAsync({
          workspaceId,
          name: name.trim(),
          subject: subject.trim(),
          document,
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
      await deleteTemplate.mutateAsync({ id });
      await invalidate();
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId) {
    return <Skeleton className="h-64" data-testid="emails-loading" />;
  }

  const templates = templatesQuery.data ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <Badge variant="outline">{t('total', { count: templates.length })}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> {t('newTemplate')}
          </Button>
        </div>
      </div>

      {editorOpen && (
        <Card data-testid="template-editor-card">
          <CardHeader>
            <CardTitle>{editingId ? t('editTitle') : t('createTitle')}</CardTitle>
            <CardDescription>{t('editorSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="template-name">{t('name')}</Label>
                <Input
                  id="template-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="template-subject">{t('subject')}</Label>
                <Input
                  id="template-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={300}
                  required
                />
              </div>
            </div>

            <TemplateEditor subject={subject} blocks={blocks} onBlocksChange={setBlocks} />

            <div className="flex gap-2">
              <Button
                onClick={onSave}
                disabled={!savable || createTemplate.isPending || updateTemplate.isPending}
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
        {templatesQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : templates.length === 0 && !editorOpen ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-base font-medium">{t('emptyTitle')}</CardTitle>
              <CardDescription>{t('emptyBody')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          templates.map((template) => (
            <Card key={template.id} data-testid="template-card">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => openEdit(template.id)} className="text-left">
                    <CardTitle className="text-base hover:underline">{template.name}</CardTitle>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('deleteAction', { name: template.name })}
                    onClick={() => onDelete(template.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                <CardDescription className="flex items-center gap-1">
                  <Mail className="size-3.5" aria-hidden /> {template.subject}
                </CardDescription>
              </CardHeader>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
