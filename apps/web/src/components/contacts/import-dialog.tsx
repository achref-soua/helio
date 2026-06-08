'use client';

import { normalizeContactRows } from '@helio/core';
import { Button } from '@helio/ui/components/button';
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

interface ParseSummary {
  rows: Array<Record<string, unknown>>;
  valid: number;
  invalid: number;
  duplicates: number;
}

export function ImportDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('contacts.import');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const importMutation = useMutation(trpc.contact.import.mutationOptions());

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const preview = normalizeContactRows(data);
        setSummary({
          rows: data,
          valid: preview.valid.length,
          invalid: preview.invalid,
          duplicates: preview.duplicates,
        });
      },
      error: () => toast.error(t('parseError')),
    });
  }

  async function onImport() {
    if (!summary) return;
    try {
      const result = await importMutation.mutateAsync({
        workspaceId,
        rows: summary.rows.slice(0, 5000),
      });
      // pathFilter matches the infinite table query; queryKey() would not.
      await queryClient.invalidateQueries(trpc.contact.list.pathFilter());
      toast.success(t('resultToast', { created: result.created, skipped: result.skippedExisting }));
      setSummary(null);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSummary(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="csv-file">{t('fileLabel')}</Label>
            <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={onFile} />
          </div>
          {summary && (
            <p className="text-muted-foreground text-sm" data-testid="import-summary">
              {t('summary', {
                valid: summary.valid,
                invalid: summary.invalid,
                duplicates: summary.duplicates,
              })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={onImport}
            disabled={!summary || summary.valid === 0 || importMutation.isPending}
          >
            {importMutation.isPending ? t('working') : t('importAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
