'use client';

import {
  type ColumnMapping,
  csvDocument,
  MAPPING_TARGETS,
  type MappingTarget,
  normalizeMappedRows,
  suggestColumnMapping,
} from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

/**
 * The guided import wizard (I1): upload → map columns → preview →
 * background import with live progress. The mapping is pre-filled from
 * the same header knowledge the auto importer used, and every column can
 * be overridden — including straight to "skip".
 */

type Step = 'upload' | 'map' | 'preview' | 'run';

const MAX_ROWS = 10_000;

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
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation(trpc.contact.importStart.mutationOptions());
  const job = useQuery({
    ...trpc.contact.importJob.queryOptions({ id: jobId ?? '' }),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' || !query.state.data ? 800 : false,
  });

  function reset() {
    setStep('upload');
    setRows([]);
    setHeaders([]);
    setMapping({});
    setUpdateExisting(true);
    setJobId(null);
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data, meta }) => {
        if (data.length === 0) {
          toast.error(t('emptyFile'));
          return;
        }
        const fileHeaders = meta.fields ?? Object.keys(data[0] ?? {});
        setRows(data.slice(0, MAX_ROWS));
        setHeaders(fileHeaders);
        setMapping(suggestColumnMapping(fileHeaders));
        setStep('map');
        if (data.length > MAX_ROWS) toast.info(t('truncated', { max: MAX_ROWS }));
      },
      error: () => toast.error(t('parseError')),
    });
  }

  const preview = step === 'preview' || step === 'map' ? normalizeMappedRows(rows, mapping) : null;
  const emailMapped = Object.values(mapping).includes('email');

  async function onStart() {
    try {
      const result = await start.mutateAsync({ workspaceId, rows, mapping, updateExisting });
      setJobId(result.jobId);
      setStep('run');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  function downloadErrors() {
    const errors = job.data?.errorRows ?? [];
    const href = URL.createObjectURL(
      new Blob(
        [
          csvDocument(
            ['row', 'reason'],
            errors.map((entry) => [entry.row, entry.reason]),
          ),
        ],
        { type: 'text/csv' },
      ),
    );
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'import-errors.csv';
    anchor.click();
    URL.revokeObjectURL(href);
  }

  const done = job.data?.status === 'DONE' || job.data?.status === 'FAILED';
  if (done && jobId) {
    // The table behind the dialog refreshes as soon as the job lands.
    void queryClient.invalidateQueries(trpc.contact.list.pathFilter());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {step === 'upload' && t('subtitle')}
            {step === 'map' && t('mapSubtitle')}
            {step === 'preview' && t('previewSubtitle')}
            {step === 'run' && t('runSubtitle')}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="grid gap-2">
            <Label htmlFor="csv-file">{t('fileLabel')}</Label>
            <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={onFile} />
          </div>
        )}

        {step === 'map' && (
          <div className="grid gap-3" data-testid="import-mapping">
            {preview && preview.source !== 'csv' && (
              <Badge variant="secondary" className="w-fit" data-testid="import-source">
                {t('detected', { source: t(`sources.${preview.source}`) })}
              </Badge>
            )}
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="px-3 py-2 font-medium">{t('column')}</th>
                    <th className="px-3 py-2 font-medium">{t('example')}</th>
                    <th className="px-3 py-2 font-medium">{t('importsAs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((header) => (
                    <tr key={header} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-medium">{header}</td>
                      <td className="text-muted-foreground max-w-40 truncate px-3 py-1.5">
                        {String(rows[0]?.[header] ?? '')}
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          aria-label={t('mappingFor', { column: header })}
                          className="border-input bg-background h-8 rounded-md border px-2"
                          value={mapping[header] ?? 'attribute'}
                          onChange={(event) =>
                            setMapping((current) => ({
                              ...current,
                              [header]: event.target.value as MappingTarget,
                            }))
                          }
                        >
                          {MAPPING_TARGETS.map((target) => (
                            <option key={target} value={target}>
                              {t(`targets.${target}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!emailMapped && <p className="text-destructive text-sm">{t('needEmail')}</p>}
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="grid gap-3" data-testid="import-preview">
            <p className="text-sm">
              {t('summary', {
                valid: preview.valid.length,
                invalid: preview.invalid,
                duplicates: preview.duplicates,
              })}
            </p>
            {preview.suppressed > 0 && (
              <p className="text-muted-foreground text-sm">
                {t('suppressed', { count: preview.suppressed })}
              </p>
            )}
            {preview.companies.length > 0 && (
              <p className="text-muted-foreground text-sm">
                {t('companies', { count: preview.companies.length })}
              </p>
            )}
            <div className="max-h-56 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="px-3 py-2 font-medium">{t('emailCol')}</th>
                    <th className="px-3 py-2 font-medium">{t('nameCol')}</th>
                    <th className="px-3 py-2 font-medium">{t('companyCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.valid.slice(0, 10).map((row) => (
                    <tr key={row.email} className="border-b last:border-0">
                      <td className="px-3 py-1.5">{row.email}</td>
                      <td className="px-3 py-1.5">
                        {[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="text-muted-foreground px-3 py-1.5">{row.company ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={updateExisting}
                onChange={() => setUpdateExisting((current) => !current)}
              />
              {t('updateExisting')}
            </label>
          </div>
        )}

        {step === 'run' && (
          <div className="grid gap-2 text-sm" data-testid="import-progress">
            {job.data?.status === 'RUNNING' && <p>{t('running')}</p>}
            {job.data && (
              <p data-testid="import-counts">
                {t('counts', {
                  created: job.data.created,
                  updated: job.data.updated,
                  skipped: job.data.skipped,
                })}
              </p>
            )}
            {job.data?.status === 'DONE' && (
              <p className="text-foreground font-medium">{t('doneTitle')}</p>
            )}
            {job.data?.status === 'FAILED' && (
              <p className="text-destructive">{job.data.error ?? t('genericError')}</p>
            )}
            {(job.data?.errorRows.length ?? 0) > 0 && (
              <Button variant="outline" size="sm" className="w-fit" onClick={downloadErrors}>
                {t('downloadErrors', { count: job.data?.errorRows.length ?? 0 })}
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'map' && (
            <Button onClick={() => setStep('preview')} disabled={!emailMapped}>
              {t('next')}
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('map')}>
                {t('backToMapping')}
              </Button>
              <Button
                onClick={onStart}
                disabled={start.isPending || (preview?.valid.length ?? 0) === 0}
              >
                {t('importAction')}
              </Button>
            </>
          )}
          {step === 'run' && done && (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              {t('close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
