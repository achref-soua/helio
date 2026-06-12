'use client';

import type { EmailBlock, EmailDocument } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useQuery } from '@tanstack/react-query';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Heading1,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  Plus,
  Text,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

let blockIdCounter = 0;
const blockId = () => `blk-${Date.now().toString(36)}-${++blockIdCounter}`;

export function newBlock(type: EmailBlock['type']): EmailBlock {
  switch (type) {
    case 'heading':
      return { id: blockId(), type, text: '' };
    case 'paragraph':
      return { id: blockId(), type, text: '' };
    case 'button':
      return { id: blockId(), type, label: '', url: 'https://' };
    case 'image':
      return { id: blockId(), type, url: 'https://', alt: '' };
    case 'divider':
    case 'spacer':
      return { id: blockId(), type };
  }
}

/** A draft document may contain incomplete blocks while the user types. */
export function draftToDocument(blocks: EmailBlock[]): EmailDocument | null {
  const complete = blocks.filter((block) => {
    if (block.type === 'heading' || block.type === 'paragraph') return block.text.trim() !== '';
    if (block.type === 'button') return block.label.trim() !== '' && isUrl(block.url);
    if (block.type === 'image') return isUrl(block.url);
    return true;
  });
  if (complete.length === 0) return null;
  return { blocks: complete };
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const BLOCK_TYPES = [
  { type: 'heading', icon: Heading1 },
  { type: 'paragraph', icon: Text },
  { type: 'button', icon: MousePointerClick },
  { type: 'image', icon: ImageIcon },
  { type: 'divider', icon: Minus },
  { type: 'spacer', icon: MoveVertical },
] as const satisfies ReadonlyArray<{
  type: EmailBlock['type'];
  icon: React.ComponentType<{ className?: string }>;
}>;

const BLOCK_ICONS = Object.fromEntries(
  BLOCK_TYPES.map(({ type, icon }) => [type, icon]),
) as unknown as Record<
  EmailBlock['type'],
  React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
>;

const ALIGNMENTS = [
  { value: 'left', icon: AlignLeft, labelKey: 'alignLeft' },
  { value: 'center', icon: AlignCenter, labelKey: 'alignCenter' },
  { value: 'right', icon: AlignRight, labelKey: 'alignRight' },
] as const;

/** Width, alignment, and rounding for an image block — plus device upload. */
function ImageBlockControls({
  block,
  onPatch,
}: {
  block: Extract<EmailBlock, { type: 'image' }>;
  onPatch: (patch: Partial<Extract<EmailBlock, { type: 'image' }>>) => void;
}) {
  const t = useTranslations('emails.editor');
  const workspaceId = useActiveWorkspaceId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onUpload(file: File) {
    if (!workspaceId) return;
    const body = new FormData();
    body.set('file', file);
    body.set('workspaceId', workspaceId);
    setUploading(true);
    try {
      const response = await fetch('/api/assets', { method: 'POST', body });
      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.url) {
        toast.error(payload.error ?? t('uploadFailed'));
        return;
      }
      onPatch({ url: payload.url });
    } catch {
      toast.error(t('uploadFailed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          aria-label={t('imageUrl')}
          placeholder="https://"
          value={block.url}
          onChange={(event) => onPatch({ url: event.target.value })}
        />
        <Input
          aria-label={t('imageAlt')}
          placeholder={t('imageAlt')}
          value={block.alt}
          onChange={(event) => onPatch({ alt: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          aria-label={t('uploadImage')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUpload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading || !workspaceId}
          onClick={() => fileRef.current?.click()}
          data-testid="image-upload"
        >
          <Upload aria-hidden /> {uploading ? t('uploading') : t('uploadImage')}
        </Button>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label={t('imageAlign')}>
          {ALIGNMENTS.map(({ value, icon: Icon, labelKey }) => {
            const active = (block.align ?? 'left') === value;
            return (
              <Button
                key={value}
                type="button"
                variant={active ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-pressed={active}
                aria-label={t(labelKey)}
                onClick={() => onPatch({ align: value })}
              >
                <Icon aria-hidden />
              </Button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground flex justify-between">
            {t('imageWidth')}
            <span className="tabular-nums">{block.width ?? 100}%</span>
          </span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={block.width ?? 100}
            onChange={(event) => onPatch({ width: Number(event.target.value) })}
            className="accent-primary"
            aria-label={t('imageWidth')}
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground flex justify-between">
            {t('imageRadius')}
            <span className="tabular-nums">{block.radius ?? 6}px</span>
          </span>
          <input
            type="range"
            min={0}
            max={32}
            step={2}
            value={block.radius ?? 6}
            onChange={(event) => onPatch({ radius: Number(event.target.value) })}
            className="accent-primary"
            aria-label={t('imageRadius')}
          />
        </label>
      </div>
    </div>
  );
}

export function TemplateEditor({
  subject,
  blocks,
  onBlocksChange,
}: {
  subject: string;
  blocks: EmailBlock[];
  onBlocksChange: (blocks: EmailBlock[]) => void;
}) {
  const t = useTranslations('emails.editor');
  const trpc = useTRPC();

  // Debounce the draft so the server render isn't hit per keystroke.
  const [debounced, setDebounced] = useState<{ subject: string; blocks: EmailBlock[] }>({
    subject,
    blocks,
  });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ subject, blocks }), 400);
    return () => clearTimeout(timer);
  }, [subject, blocks]);

  const document = useMemo(() => draftToDocument(debounced.blocks), [debounced.blocks]);
  const previewQuery = useQuery({
    ...trpc.emailTemplate.preview.queryOptions(
      { subject: debounced.subject, document: document! },
      { placeholderData: (previous) => previous },
    ),
    enabled: document !== null,
  });

  function updateBlock(id: string, patch: Partial<EmailBlock>) {
    onBlocksChange(
      blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as EmailBlock) : block)),
    );
  }
  function removeBlock(id: string) {
    onBlocksChange(blocks.filter((block) => block.id !== id));
  }
  function moveBlock(id: string, direction: -1 | 1) {
    const index = blocks.findIndex((block) => block.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onBlocksChange(next);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid content-start gap-3" data-testid="block-list">
        {blocks.map((block) => {
          const Icon = BLOCK_ICONS[block.type];
          return (
            <Card key={block.id} className="gap-0 py-3" data-testid={`block-${block.type}`}>
              <CardContent className="grid gap-2.5 px-3">
                <div className="flex items-center gap-2">
                  <span className="bg-primary/12 text-primary inline-flex size-6 items-center justify-center rounded-md">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    {t(`blocks.${block.type}`)}
                  </span>
                  <div className="ml-auto flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('moveUp')}
                      onClick={() => moveBlock(block.id, -1)}
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('moveDown')}
                      onClick={() => moveBlock(block.id, 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      aria-label={t('removeBlock')}
                      onClick={() => removeBlock(block.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>

                {(block.type === 'heading' || block.type === 'paragraph') && (
                  <Input
                    aria-label={t('text')}
                    placeholder={t('textPlaceholder')}
                    value={block.text}
                    onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                  />
                )}
                {block.type === 'button' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      aria-label={t('buttonLabel')}
                      placeholder={t('buttonLabel')}
                      value={block.label}
                      onChange={(event) => updateBlock(block.id, { label: event.target.value })}
                    />
                    <Input
                      aria-label={t('url')}
                      placeholder="https://"
                      value={block.url}
                      onChange={(event) => updateBlock(block.id, { url: event.target.value })}
                    />
                  </div>
                )}
                {block.type === 'image' && (
                  <ImageBlockControls
                    block={block}
                    onPatch={(patch) => updateBlock(block.id, patch)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="justify-self-start">
              <Plus aria-hidden /> {t('addBlock')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72 p-1.5">
            {BLOCK_TYPES.map(({ type, icon: Icon }) => (
              <DropdownMenuItem
                key={type}
                className="items-start gap-3 rounded-md px-2.5 py-2"
                onClick={() => onBlocksChange([...blocks, newBlock(type)])}
              >
                <span className="bg-primary/12 text-primary mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{t(`blocks.${type}`)}</span>
                  <span className="text-muted-foreground text-xs">
                    {t(`blockDescriptions.${type}`)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <p className="text-muted-foreground text-xs">{t('tokensHint')}</p>
      </div>

      <div className="grid content-start gap-2">
        <Label>{t('preview')}</Label>
        {document === null ? (
          <div className="text-muted-foreground rounded-md border p-6 text-sm">
            {t('previewEmpty')}
          </div>
        ) : (
          <iframe
            title={t('preview')}
            sandbox=""
            srcDoc={previewQuery.data?.html ?? ''}
            className="h-[480px] w-full rounded-md border bg-white"
            data-testid="template-preview"
          />
        )}
        {previewQuery.data && (
          <p className="text-muted-foreground text-xs" data-testid="preview-subject">
            {t('subjectPreview', { subject: previewQuery.data.subject })}
          </p>
        )}
      </div>
    </div>
  );
}
