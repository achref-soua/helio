'use client';

import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

/**
 * The audit-log viewer: who did what, when, to which object — filterable
 * by action family, actor, and date range; paginated by cursor; the
 * current filter exports as CSV (capped at 1,000 rows, flagged when cut).
 */
export function AuditView() {
  const t = useTranslations('admin.audit');
  const trpc = useTRPC();
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Drafts apply on submit — typing must not refetch per keystroke.
  const [applied, setApplied] = useState<{
    action: string;
    actor: string;
    from: string;
    to: string;
  }>({ action: '', actor: '', from: '', to: '' });

  const filters = {
    action: applied.action || undefined,
    actor: applied.actor || undefined,
    from: applied.from ? new Date(applied.from) : undefined,
    // The picker yields a day; include the whole of it.
    to: applied.to ? new Date(`${applied.to}T23:59:59.999Z`) : undefined,
  };

  const list = useInfiniteQuery(
    trpc.admin.auditList.infiniteQueryOptions(filters, {
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const exportCsv = useMutation(trpc.admin.auditExportCsv.mutationOptions());

  const entries = list.data?.pages.flatMap((page) => page.entries) ?? [];

  async function onExport() {
    try {
      const result = await exportCsv.mutateAsync(filters);
      const href = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv' }));
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'helio-audit-log.csv';
      anchor.click();
      URL.revokeObjectURL(href);
      if (result.truncated) toast.info(t('truncated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('exportFailed'));
    }
  }

  return (
    <div className="grid gap-4" data-testid="audit-view">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ action, actor, from, to });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="audit-action">{t('actionFilter')}</Label>
          <Input
            id="audit-action"
            placeholder="auth."
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="w-44"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-actor">{t('actorFilter')}</Label>
          <Input
            id="audit-actor"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            className="w-44"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-from">{t('from')}</Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-to">{t('to')}</Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          {t('apply')}
        </Button>
        <Button type="button" variant="outline" onClick={onExport} disabled={exportCsv.isPending}>
          <Download className="size-4" aria-hidden /> {t('export')}
        </Button>
      </form>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-4 py-2 font-medium">{t('time')}</th>
                <th className="px-4 py-2 font-medium">{t('actor')}</th>
                <th className="px-4 py-2 font-medium">{t('action')}</th>
                <th className="px-4 py-2 font-medium">{t('target')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0" data-testid="audit-row">
                  <td className="text-muted-foreground px-4 py-2 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{entry.actor ?? t('system')}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs">{entry.action}</code>
                  </td>
                  <td className="text-muted-foreground px-4 py-2">
                    {entry.targetType ? `${entry.targetType} · ${entry.targetId ?? ''}` : '—'}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && !list.isLoading && (
                <tr>
                  <td colSpan={4} className="text-muted-foreground px-4 py-8 text-center">
                    {t('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {list.hasNextPage && (
        <div>
          <Button
            variant="outline"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
