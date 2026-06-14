'use client';

import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpCircle, CheckCircle2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

function isTerminal(phase: string | undefined): boolean {
  return phase === 'done' || phase === 'failed';
}

/**
 * Settings → Updates. Shows the running build, whether a newer release
 * exists, and — for an owner on a deployment with the update sidecar — a
 * one-click update. The update restarts the whole stack (this app included),
 * so the panel polls the sidecar's status across the downtime and offers a
 * reload when the new version is live. Everyone else sees the version and,
 * when relevant, a notice to update from the terminal.
 */
export function UpdatesPanel() {
  const t = useTranslations('updates');
  const trpc = useTRPC();

  const [updating, setUpdating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const check = useQuery(trpc.updates.check.queryOptions());
  const inAppEnabled = check.data?.inAppEnabled ?? false;

  const status = useQuery({
    ...trpc.updates.status.queryOptions(),
    enabled: inAppEnabled,
    // Poll fast while a job runs and keep retrying through the restart the
    // update causes; stop once it reaches a terminal phase.
    refetchInterval: (query) => {
      const phase = query.state.data?.job?.phase;
      return updating && !isTerminal(phase) ? 2500 : false;
    },
    retry: true,
    retryDelay: 2000,
  });

  const job = status.data?.job ?? null;
  // Adopt a job that was already running when the page loaded (e.g. a refresh
  // mid-update). Render-time + converges: once `updating` is true it stops.
  if (!updating && job && !isTerminal(job.phase)) setUpdating(true);

  const start = useMutation(trpc.updates.start.mutationOptions());
  const currentVersion = check.data?.currentVersion;
  const latest = check.data?.latest ?? null;

  async function onConfirmUpdate() {
    setConfirmOpen(false);
    try {
      await start.mutateAsync({ target: latest?.version });
      setUpdating(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Card data-testid="updates-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpCircle className="size-4" aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('current')}</span>
          <span className="font-mono">
            {currentVersion
              ? currentVersion === 'dev'
                ? t('devBuild')
                : `v${currentVersion}`
              : '—'}
          </span>
        </div>

        {updating ? (
          <UpdateProgress phase={job?.phase} message={job?.message} version={job?.version} t={t} />
        ) : currentVersion === 'dev' ? (
          <p className="text-muted-foreground">{t('devNote')}</p>
        ) : check.data?.updateAvailable && latest ? (
          <div className="grid gap-2">
            <p className="font-medium">{t('available', { version: latest.version })}</p>
            <a
              className="text-muted-foreground w-fit underline underline-offset-4"
              href={latest.url}
              target="_blank"
              rel="noreferrer"
            >
              {t('releaseNotes')}
            </a>
            {check.data.canUpdate ? (
              <Button className="w-fit" onClick={() => setConfirmOpen(true)}>
                {t('updateNow', { version: latest.version })}
              </Button>
            ) : inAppEnabled ? (
              <p className="text-muted-foreground text-xs">{t('ownerOnly')}</p>
            ) : (
              <p className="text-muted-foreground text-xs">{t('terminalHint')}</p>
            )}
          </div>
        ) : check.data ? (
          <p className="text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="size-4" aria-hidden /> {t('upToDate')}
          </p>
        ) : null}

        {!updating && (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => check.refetch()}
              disabled={check.isFetching}
            >
              {check.isFetching ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {t('check')}
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('confirmTitle', { version: latest?.version ?? '' })}</DialogTitle>
            <DialogDescription>{t('confirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={onConfirmUpdate} disabled={start.isPending}>
              {start.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {t('confirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function UpdateProgress({
  phase,
  message,
  version,
  t,
}: {
  phase: string | undefined;
  message: string | undefined;
  version: string | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  if (phase === 'done') {
    return (
      <div className="grid gap-2" data-testid="update-done">
        <p className="flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="size-4" aria-hidden />
          {t('done', { version: version ? `v${version.replace(/^v/, '')}` : '' })}
        </p>
        <Button className="w-fit" onClick={() => window.location.reload()}>
          {t('reload')}
        </Button>
      </div>
    );
  }
  if (phase === 'failed') {
    return (
      <p className="text-destructive flex items-start gap-1.5" data-testid="update-failed">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {message || t('failed')}
      </p>
    );
  }
  return (
    <div className="grid gap-1" data-testid="update-running" aria-live="polite">
      <p className="flex items-center gap-2 font-medium">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {message || t('working')}
      </p>
      <p className="text-muted-foreground text-xs">{t('downtimeHint')}</p>
    </div>
  );
}
