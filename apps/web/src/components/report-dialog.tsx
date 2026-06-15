'use client';

import { buildSupportIssue, githubNewIssueUrl, SUPPORT_KINDS, type SupportKind } from '@helio/core';
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
import { useMutation, useQuery } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ThemedSelect } from '@/components/themed-select';
import { useTRPC } from '@/trpc/client';

const FIELD_CLASS =
  'border-input bg-transparent dark:bg-input/30 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

/** Globally-available "Report a bug / send feedback" entry point — files to GitHub. */
export function ReportDialog() {
  const t = useTranslations('support');
  const trpc = useTRPC();
  const config = useQuery(trpc.support.config.queryOptions());
  const report = useMutation(trpc.support.report.mutationOptions());
  const [open, setOpen] = useState(false);

  const cfg = config.data;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cfg) return;
    const form = new FormData(event.currentTarget);
    const input = {
      kind: String(form.get('kind')) as SupportKind,
      subject: String(form.get('subject')),
      body: String(form.get('body')),
      url: typeof window === 'undefined' ? undefined : window.location.pathname,
    };

    if (cfg.hasToken) {
      // A PAT is configured: create the issue server-side, then offer a link.
      report
        .mutateAsync(input)
        .then((result) => {
          toast.success(t('reported'), {
            action: {
              label: t('viewOnGithub'),
              onClick: () => window.open(result.url, '_blank', 'noopener,noreferrer'),
            },
          });
          setOpen(false);
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : t('genericError'));
        });
      return;
    }

    // No token: open a prefilled new-issue page in a new tab (no server call).
    // Opened synchronously from the click so the browser does not block it.
    const issue = buildSupportIssue({
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      pageUrl: input.url,
      reporterEmail: cfg.reporterEmail,
      version: cfg.version,
    });
    window.open(
      githubNewIssueUrl({ owner: cfg.owner, repo: cfg.repo }, issue),
      '_blank',
      'noopener,noreferrer',
    );
    toast.success(t('openingGithub'));
    setOpen(false);
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
      </DialogContent>
    </Dialog>
  );
}
