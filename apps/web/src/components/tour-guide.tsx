'use client';

import { Button } from '@helio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { cn } from '@helio/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** Bump the version to re-show the tour after a meaningful product change. */
const STORAGE_KEY = 'helio.tour.v1.done';
const STEPS = ['welcome', 'contacts', 'journeys', 'copilot', 'crm', 'support'] as const;

/**
 * A one-time product tour for new operators. Auto-opens unless dismissed
 * (per-browser via localStorage); the e2e suite seeds the dismissed flag so
 * it never blocks other specs. Dependency-free.
 */
export function TourGuide() {
  const t = useTranslations('tour');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Defer the open by a tick so the read+set isn't a synchronous effect setState
  // (and so it runs only on the client, where localStorage exists).
  useEffect(() => {
    const id = setTimeout(() => {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setOpen(false);
  }

  const key = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent className="sm:max-w-md" data-testid="tour">
        <DialogHeader>
          <DialogTitle>{t(`steps.${key}.title`)}</DialogTitle>
          <DialogDescription>{t(`steps.${key}.body`)}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-1.5" aria-hidden>
          {STEPS.map((stepKey, index) => (
            <span
              key={stepKey}
              className={cn(
                'size-1.5 rounded-full',
                index === step ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            />
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={dismiss} data-testid="tour-skip">
            {t('skip')}
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
                {t('back')}
              </Button>
            )}
            {isLast ? (
              <Button onClick={dismiss} data-testid="tour-done">
                {t('done')}
              </Button>
            ) : (
              <Button onClick={() => setStep((s) => s + 1)} data-testid="tour-next">
                {t('next')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
