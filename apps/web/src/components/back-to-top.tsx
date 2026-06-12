'use client';

import { cn } from '@helio/ui/lib/utils';
import { ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** Appears once the page has scrolled this far — roughly a viewport. */
const SHOW_AFTER_PX = 600;

/**
 * The floating return-to-top control: a sunlit disc in the bottom-right
 * that fades in after a real scroll and glides the page back up,
 * honoring reduced-motion preferences.
 */
export function BackToTop() {
  const t = useTranslations('app');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVisible(window.scrollY > SHOW_AFTER_PX));
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  function onClick() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('backToTop')}
      data-testid="back-to-top"
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
      className={cn(
        'from-primary to-primary/85 text-primary-foreground fixed right-6 bottom-6 z-40 inline-flex size-11 items-center justify-center rounded-full bg-linear-to-b shadow-[inset_0_1px_0_oklch(1_0_0/0.22),0_4px_14px_-4px_oklch(0.1_0.02_264/0.5)] transition-all duration-300 hover:brightness-[1.05] active:scale-95',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  );
}
