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
import { DatabaseBackup, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
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

  const list = useQuery({
    ...trpc.backups.list.queryOptions(),
    enabled: isOwner,
    refetchInterval: 20_000,
  });
  const runNow = useMutation(trpc.backups.runNow.mutationOptions());

  if (!isOwner || !list.data?.enabled) return null;

  async function onRunNow() {
    try {
      await runNow.mutateAsync();
      toast.success(t('queued'));
      setTimeout(() => queryClient.invalidateQueries(trpc.backups.list.pathFilter()), 20_000);
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
        <div>
          <Button onClick={onRunNow} disabled={runNow.isPending}>
            {t('runNow')}
          </Button>
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
                        className="text-primary inline-flex items-center gap-1 underline underline-offset-4"
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
