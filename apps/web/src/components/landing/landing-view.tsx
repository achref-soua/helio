'use client';

import {
  emptyLandingBlock,
  LANDING_BLOCK_TYPES,
  type LandingBlock,
  type LandingBlockType,
} from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { cn } from '@helio/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const FIELD_CLASS =
  'border-input bg-transparent dark:bg-input/30 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

export function LandingView() {
  const t = useTranslations('landing');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [editingId, setEditingId] = useState<string | null>(null);

  const list = useQuery({
    ...trpc.landing.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  const create = useMutation(trpc.landing.create.mutationOptions());

  async function onCreate() {
    if (!workspaceId) return;
    try {
      const { id } = await create.mutateAsync({ workspaceId, title: t('untitled') });
      await queryClient.invalidateQueries(trpc.landing.list.pathFilter());
      setEditingId(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId || list.isLoading) {
    return <Skeleton className="h-72" data-testid="landing-loading" />;
  }

  if (editingId) {
    return <LandingEditor id={editingId} onClose={() => setEditingId(null)} />;
  }

  const rows = list.data ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="text-primary size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Button size="sm" className="ml-auto" onClick={onCreate} data-testid="landing-new">
          <Plus aria-hidden /> {t('new')}
        </Button>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">{t('subtitle')}</p>

      {rows.length === 0 ? (
        <Card data-testid="landing-empty">
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="bg-background flex items-center gap-3 rounded-md border p-3 text-sm"
              data-testid="landing-row"
            >
              <button
                className="font-medium hover:underline"
                onClick={() => setEditingId(row.id)}
                data-testid="landing-edit"
              >
                {row.title}
              </button>
              <Badge variant={row.published ? 'secondary' : 'outline'}>
                {row.published ? t('published') : t('draft')}
              </Badge>
              <span className="text-muted-foreground ml-auto text-xs">
                {new Date(row.updatedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LandingEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('landing');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pageQuery = useQuery(trpc.landing.get.queryOptions({ id }));
  const update = useMutation(trpc.landing.update.mutationOptions());

  const [seeded, setSeeded] = useState(false);
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<LandingBlock[]>([]);

  const page = pageQuery.data;
  if (page && !seeded) {
    setSeeded(true);
    setTitle(page.title);
    setBlocks((page.blocks as unknown as LandingBlock[]) ?? []);
  }

  function addBlock(type: LandingBlockType) {
    setBlocks((current) => [...current, emptyLandingBlock(type)]);
  }
  function patchBlock(index: number, patch: Partial<LandingBlock>) {
    setBlocks((current) =>
      current.map((block, i) => (i === index ? ({ ...block, ...patch } as LandingBlock) : block)),
    );
  }
  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  function removeBlock(index: number) {
    setBlocks((current) => current.filter((_, i) => i !== index));
  }

  async function save(published?: boolean) {
    try {
      await update.mutateAsync({ id, title: title.trim(), blocks, published });
      await queryClient.invalidateQueries(trpc.landing.get.pathFilter());
      await queryClient.invalidateQueries(trpc.landing.list.pathFilter());
      toast.success(
        published === undefined
          ? t('saved')
          : published
            ? t('publishedToast')
            : t('unpublishedToast'),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('invalidBlocks'));
    }
  }

  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/p/${id}`);
    toast.success(t('linkCopied'));
  }

  if (pageQuery.isLoading) return <Skeleton className="h-72" />;

  return (
    <div className="grid max-w-2xl gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          ← {t('back')}
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => save()}
            disabled={update.isPending}
            data-testid="landing-save"
          >
            {t('save')}
          </Button>
          <Button
            size="sm"
            onClick={() => save(!page?.published)}
            disabled={update.isPending}
            data-testid="landing-publish"
          >
            {page?.published ? t('unpublish') : t('publish')}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="lp-title">{t('pageTitle')}</Label>
        <Input
          id="lp-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          data-testid="landing-title"
        />
        {page?.published && (
          <button
            type="button"
            onClick={copyLink}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            data-testid="landing-copy-link"
          >
            <Copy className="size-3" aria-hidden /> <code>/p/{id}</code>
          </button>
        )}
      </div>

      <div className="grid gap-2" data-testid="landing-blocks">
        {blocks.map((block, index) => (
          <div key={index} className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {t(`blocks.${block.type}`)}
              </Badge>
              <div className="ml-auto flex gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('moveUp')}
                  onClick={() => moveBlock(index, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('moveDown')}
                  onClick={() => moveBlock(index, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('removeBlock')}
                  onClick={() => removeBlock(index)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <BlockFields
              block={block}
              onPatch={(patch) => patchBlock(index, patch)}
              fieldClass={FIELD_CLASS}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {LANDING_BLOCK_TYPES.map((type) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            onClick={() => addBlock(type)}
            data-testid={`landing-add-${type}`}
          >
            <Plus aria-hidden /> {t(`blocks.${type}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function BlockFields({
  block,
  onPatch,
  fieldClass,
}: {
  block: LandingBlock;
  onPatch: (patch: Partial<LandingBlock>) => void;
  fieldClass: string;
}) {
  switch (block.type) {
    case 'heading':
      return (
        <Input
          value={block.text}
          onChange={(e) => onPatch({ text: e.target.value })}
          maxLength={200}
        />
      );
    case 'text':
      return (
        <textarea
          value={block.text}
          onChange={(e) => onPatch({ text: e.target.value })}
          rows={3}
          maxLength={2000}
          className={cn(fieldClass, 'w-full')}
        />
      );
    case 'image':
      return (
        <div className="grid gap-2">
          <Input
            value={block.url}
            onChange={(e) => onPatch({ url: e.target.value })}
            placeholder="https://…"
          />
          <Input
            value={block.alt}
            onChange={(e) => onPatch({ alt: e.target.value })}
            placeholder="Alt text"
            maxLength={200}
          />
        </div>
      );
    case 'button':
      return (
        <div className="grid gap-2">
          <Input
            value={block.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            maxLength={80}
          />
          <Input
            value={block.href}
            onChange={(e) => onPatch({ href: e.target.value })}
            placeholder="https://…"
          />
        </div>
      );
    case 'form':
      return (
        <Input
          value={block.buttonLabel}
          onChange={(e) => onPatch({ buttonLabel: e.target.value })}
          maxLength={80}
        />
      );
  }
}
