'use client';

import { SUPPORT_KINDS, type SupportKind } from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ThemedSelect } from '@/components/themed-select';
import { useTRPC } from '@/trpc/client';

/** A report's status → its badge styling. RESOLVED is the happy path. */
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  RESOLVED: 'default',
  DECLINED: 'outline',
  SUBMITTED: 'secondary',
};

const FIELD_CLASS =
  'border-input bg-transparent dark:bg-input/30 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

/** Globally-available "Report a bug / send feedback" entry point — files to GitHub + email. */
export function ReportDialog() {
  const t = useTranslations('support');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const config = useQuery(trpc.support.config.queryOptions());
  const report = useMutation(trpc.support.report.mutationOptions());
  // The filer's own reports + their live status, loaded only while the dialog is
  // open. Paired with updates.check to nudge "a fix shipped — update to install".
  const [open, setOpen] = useState(false);
  const myReports = useQuery({ ...trpc.support.myReports.queryOptions(), enabled: open });
  const updates = useQuery({ ...trpc.updates.check.queryOptions(), enabled: open });

  const cfg = config.data;
  const reports = myReports.data ?? [];
  const updateAvailable = updates.data?.updateAvailable ?? false;
  const latestVersion = updates.data?.latest?.version ?? '';

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      kind: String(form.get('kind')) as SupportKind,
      subject: String(form.get('subject')),
      body: String(form.get('body')),
      url: typeof window === 'undefined' ? undefined : window.location.pathname,
    };

    // The report is filed entirely server-side (GitHub issue + email); we just
    // confirm, linking the created issue when there is one.
    report
      .mutateAsync(input)
      .then((result) => {
        if (result.created && result.url) {
          const issueUrl = result.url;
          toast.success(t('reported'), {
            action: {
              label: t('viewOnGithub'),
              onClick: () => window.open(issueUrl, '_blank', 'noopener,noreferrer'),
            },
          });
        } else {
          toast.success(t('sent'));
        }
        // Refresh "Your reports" so the new submission shows next time it opens.
        void queryClient.invalidateQueries(trpc.support.myReports.pathFilter());
        setOpen(false);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t('genericError'));
      });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('open')} data-testid="report-open">
          <LifeBuoy aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {cfg ? t('subtitleRepo', { repo: cfg.repoSlug }) : t('subtitle')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="report-kind">{t('kind')}</Label>
            <ThemedSelect
              id="report-kind"
              name="kind"
              defaultValue={SUPPORT_KINDS[0]}
              className="w-full"
              options={SUPPORT_KINDS.map((kind) => ({
                value: kind,
                label: t(`kinds.${kind}`),
              }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="report-subject">{t('subject')}</Label>
            <Input
              id="report-subject"
              name="subject"
              required
              maxLength={160}
              data-testid="report-subject"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="report-body">{t('body')}</Label>
            <textarea
              id="report-body"
              name="body"
              required
              rows={4}
              maxLength={5000}
              className={FIELD_CLASS}
              data-testid="report-body"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!cfg || report.isPending} data-testid="report-submit">
              {report.isPending ? t('sending') : t('send')}
            </Button>
          </DialogFooter>
        </form>

        {reports.length > 0 && (
          <div className="mt-2 grid gap-2 border-t pt-4" data-testid="my-reports">
            <p className="text-sm font-medium">{t('yourReports')}</p>
            <ul className="grid gap-2">
              {reports.map((r) => {
                const fixShipped = r.status === 'RESOLVED' && updateAvailable;
                return (
                  <li key={r.id} className="grid gap-1 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {r.issueUrl ? (
                          <a
                            href={r.issueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {r.subject}
                          </a>
                        ) : (
                          r.subject
                        )}
                      </span>
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'} className="shrink-0">
                        {t(`status.${r.status}`)}
                      </Badge>
                    </div>
                    {fixShipped && (
                      <Link
                        href="/settings"
                        onClick={() => setOpen(false)}
                        className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                      >
                        {t('updateAvailable', { version: latestVersion })}
                        <ArrowUpRight className="size-3" aria-hidden />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
