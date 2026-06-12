'use client';

import { Button } from '@helio/ui/components/button';
import { cn } from '@helio/ui/lib/utils';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

/** Bump the version to re-show the tour after a meaningful product change. */
const STORAGE_KEY = 'helio.tour.v1.done';
const START_EVENT = 'helio:tour-start';

/**
 * Each step spotlights a real piece of the product (a `data-tour` target);
 * steps without a target — or whose target is off-screen, as on mobile —
 * fall back to a centered card over a plain dim.
 */
const STEPS: ReadonlyArray<{ key: string; target?: string }> = [
  { key: 'welcome' },
  { key: 'contacts', target: 'contacts' },
  { key: 'journeys', target: 'journeys' },
  { key: 'copilot', target: 'copilot' },
  { key: 'crm', target: 'deals' },
  { key: 'support', target: 'support' },
];

/** Reopen the tour from anywhere (the Help menu, the usage guide). */
export function startProductTour(): void {
  window.dispatchEvent(new Event(START_EVENT));
}

interface Spot {
  rect: { top: number; left: number; width: number; height: number } | null;
  card: React.CSSProperties;
}

const CENTERED: Spot = {
  rect: null,
  card: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Pick a card position beside the spotlight: right, below, above, center. */
function locate(target: Element | null): Spot {
  if (!target) return CENTERED;
  const box = target.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return CENTERED;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(vw * 0.92, 384);
  const height = 280;
  const gap = 16;
  const rect = { top: box.top, left: box.left, width: box.width, height: box.height };
  if (box.right + gap + width <= vw) {
    return { rect, card: { left: box.right + gap, top: clamp(box.top - 8, gap, vh - height) } };
  }
  if (box.bottom + gap + height <= vh) {
    return {
      rect,
      card: {
        left: clamp(box.left + box.width / 2 - width / 2, gap, vw - width - gap),
        top: box.bottom + gap,
      },
    };
  }
  if (box.top - gap - height >= 0) {
    return {
      rect,
      card: {
        left: clamp(box.left + box.width / 2 - width / 2, gap, vw - width - gap),
        top: box.top - gap - height,
      },
    };
  }
  return CENTERED;
}

/**
 * A one-time, dependency-free product tour for new operators: it dims the
 * app, spotlights the section each step talks about, and walks with the
 * reader. Auto-opens unless dismissed (per-browser via localStorage); the
 * e2e suite seeds the dismissed flag so it never blocks other specs.
 */
export function TourGuide() {
  const t = useTranslations('tour');
  const pathname = usePathname();
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [spot, setSpot] = useState<Spot>(CENTERED);

  // Defer the open by a tick so the read+set isn't a synchronous effect setState
  // (and so it runs only on the client, where localStorage exists).
  useEffect(() => {
    const id = setTimeout(() => {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // The Help menu can restart the tour at any time, from the first step.
  useEffect(() => {
    const onStart = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, []);

  const measure = useCallback(() => {
    const target = STEPS[step]?.target;
    const element = target ? document.querySelector(`[data-tour="${target}"]`) : null;
    setSpot(locate(element));
  }, [step]);

  // Spotlight the step's target: scroll it into view, measure, and keep
  // following it through resizes and scrolls.
  useEffect(() => {
    if (!open) return;
    const target = STEPS[step]?.target;
    const element = target ? document.querySelector(`[data-tour="${target}"]`) : null;
    element?.scrollIntoView({ block: 'nearest' });
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, step, pathname, measure]);

  // The card behaves like a dialog: focused on entry, Escape leaves.
  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        localStorage.setItem(STORAGE_KEY, '1');
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setOpen(false);
  }

  if (!open) return null;

  const key = STEPS[step]!.key;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {spot.rect ? (
        <div
          aria-hidden
          className="ring-primary absolute rounded-lg ring-2 transition-all duration-300"
          style={{
            top: spot.rect.top - 6,
            left: spot.rect.left - 6,
            width: spot.rect.width + 12,
            height: spot.rect.height + 12,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="tour"
        className="bg-background absolute grid w-[min(92vw,24rem)] gap-4 rounded-xl border p-5 shadow-xl outline-none"
        style={spot.card}
      >
        <div className="grid gap-1.5">
          <h2 id={titleId} className="text-lg leading-none font-semibold">
            {t(`steps.${key}.title`)}
          </h2>
          <p className="text-muted-foreground text-sm">{t(`steps.${key}.body`)}</p>
        </div>

        <div className="flex justify-center gap-1.5" aria-hidden>
          {STEPS.map((entry, index) => (
            <span
              key={entry.key}
              className={cn(
                'size-1.5 rounded-full',
                index === step ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
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
        </div>
      </div>
    </div>
  );
}
