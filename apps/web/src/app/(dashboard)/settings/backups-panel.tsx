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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helio/ui/components/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

const STATUS_TONE = {
  OK: 'default',
  RUNNING: 'secondary',
  FAILED: 'destructive',
  PRUNED: 'outline',
} as const;

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function BackupsPanel({ isOwner }: { isOwner: boolean }) {
  const t = useTranslations('backups');
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // While a requested run is in flight the list polls fast, so the new
  // row appears within seconds of the sidecar picking the request up —
  // a queued backup that shows nothing for half a minute reads as a
  // dead button.
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const list = useQuery({
    ...trpc.backups.list.queryOptions(),
    enabled: isOwner,
    refetchInterval: pendingSince ? 3_000 : 20_000,
  });
  const runNow = useMutation(trpc.backups.runNow.mutationOptions());

  // Render-time guard: the moment a run newer than the request lands,
  // the pending banner retires itself.
  if (pendingSince) {
    const landed = list.data?.runs.some(
      // 15s of clock-skew allowance between this browser and the server.
      (run) => new Date(run.startedAt).getTime() >= pendingSince - 15_000,
    );
    // Give up after 90s so a stopped sidecar can't pin the button; the
    // stale banner below explains the real condition. dataUpdatedAt is
    // the query's own clock — render-pure, and it advances with every
    // 3-second poll while a run is pending.
    if (landed || list.dataUpdatedAt - pendingSince > 90_000) setPendingSince(null);
  }

  if (!isOwner || !list.data?.enabled) return null;

  async function onRunNow() {
    try {
      await runNow.mutateAsync();
      setPendingSince(Date.now());
      toast.success(t('queued'));
      await queryClient.invalidateQueries(trpc.backups.list.pathFilter());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Card data-testid="backups-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="size-4" aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {list.data.stale ? <p className="text-destructive text-sm">{t('stale')}</p> : null}
        <div className="flex items-center gap-3">
          <Button onClick={onRunNow} disabled={runNow.isPending || pendingSince !== null}>
            {pendingSince !== null && <Loader2 className="animate-spin" aria-hidden />}
            {pendingSince !== null ? t('inProgress') : t('runNow')}
          </Button>
          {pendingSince !== null && (
            <span className="text-muted-foreground text-xs" data-testid="backup-pending">
              {t('pendingHint')}
            </span>
          )}
        </div>
        {list.data.runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('when')}</TableHead>
                <TableHead>{t('label')}</TableHead>
                <TableHead>{t('size')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(run.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {run.label}
                    {run.encrypted ? (
                      <Badge variant="outline" className="ml-2">
                        {t('encrypted')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatSize(run.sizeBytes)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_TONE[run.status as keyof typeof STATUS_TONE] ?? 'outline'}
                    >
                      {run.status}
                    </Badge>
                    {run.error ? (
                      <span className="text-destructive ml-2 text-xs">{run.error}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {run.status === 'OK' ? (
                      <a
                        className="text-foreground inline-flex items-center gap-1 underline underline-offset-4"
                        href={`/api/admin/backups/${run.id}`}
                        aria-label={t('downloadAria', { file: run.filename })}
                      >
                        <Download className="size-3.5" aria-hidden /> {t('download')}
                      </a>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-muted-foreground text-xs">{t('restoreHint')}</p>
      </CardContent>
    </Card>
  );
}
