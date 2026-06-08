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
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

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

const BLOCK_TYPES: EmailBlock['type'][] = [
  'heading',
  'paragraph',
  'button',
  'image',
  'divider',
  'spacer',
];

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
        {blocks.map((block) => (
          <Card key={block.id} data-testid={`block-${block.type}`}>
            <CardContent className="grid gap-2 p-3">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground text-xs font-medium uppercase">
                  {t(`blocks.${block.type}`)}
                </span>
                <div className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('moveUp')}
                    onClick={() => moveBlock(block.id, -1)}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('moveDown')}
                    onClick={() => moveBlock(block.id, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
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
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label={t('imageUrl')}
                    placeholder="https://"
                    value={block.url}
                    onChange={(event) => updateBlock(block.id, { url: event.target.value })}
                  />
                  <Input
                    aria-label={t('imageAlt')}
                    placeholder={t('imageAlt')}
                    value={block.alt}
                    onChange={(event) => updateBlock(block.id, { alt: event.target.value })}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="justify-self-start">
              <Plus aria-hidden /> {t('addBlock')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {BLOCK_TYPES.map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => onBlocksChange([...blocks, newBlock(type)])}
              >
                {t(`blocks.${type}`)}
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
