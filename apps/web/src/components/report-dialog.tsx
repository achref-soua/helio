'use client';

import { SUPPORT_KINDS, type SupportKind } from '@helio/core';
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
import { cn } from '@helio/ui/lib/utils';
import { useMutation } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

const FIELD_CLASS =
  'border-input bg-transparent dark:bg-input/30 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

/** Globally-available "Report a bug / send feedback" entry point. */
export function ReportDialog() {
  const t = useTranslations('support');
  const trpc = useTRPC();
  const create = useMutation(trpc.support.create.mutationOptions());
  const [open, setOpen] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await create.mutateAsync({
        kind: String(form.get('kind')) as SupportKind,
        subject: String(form.get('subject')),
        body: String(form.get('body')),
        url: typeof window === 'undefined' ? undefined : window.location.pathname,
      });
      toast.success(t('sent'));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
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
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="report-kind">{t('kind')}</Label>
            <select id="report-kind" name="kind" className={cn(FIELD_CLASS, 'h-9')}>
              {SUPPORT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </option>
              ))}
            </select>
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
            <Button type="submit" disabled={create.isPending} data-testid="report-submit">
              {create.isPending ? t('sending') : t('send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
