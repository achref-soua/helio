'use client';

import { Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { BrandMark } from '@/components/app-shell';

/**
 * The Helio sun, doing what suns do: a sunrise splash the first time the
 * dashboard opens in a browser session, and a sunset when the user signs
 * out. Pure CSS keyframes (see globals.css), no animation library; users
 * who prefer reduced motion never see either — the sunrise is skipped and
 * `playSunset` resolves immediately.
 */

const SUNSET_EVENT = 'helio:sunset';
const SUNSET_DONE_EVENT = 'helio:sunset-done';
const SUNRISE_KEY = 'helio:sunrise-played';
const SUNRISE_MS = 2100;
const SUNSET_MS = 1400;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Play the sunset and resolve when it has finished (immediately under
 * reduced motion). The overlay keeps its final dusk frame up until
 * navigation unmounts the shell, so sign-out never flashes the dashboard.
 */
export function playSunset(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    // Safety net: if no host is mounted, don't hold the sign-out hostage.
    const timeout = window.setTimeout(resolve, SUNSET_MS + 1000);
    window.addEventListener(
      SUNSET_DONE_EVENT,
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    window.dispatchEvent(new Event(SUNSET_EVENT));
  });
}

export function SunSplash({ brand }: { brand?: BrandMark }) {
  const t = useTranslations('app');
  const [mode, setMode] = useState<'sunrise' | 'sunset' | null>(null);

  useEffect(() => {
    // Once per browser session (sessionStorage, not localStorage — a new
    // visit the next day deserves a new dawn), decided after hydration so
    // the server renders nothing and there is no mismatch.
    if (prefersReducedMotion() || window.sessionStorage.getItem(SUNRISE_KEY) === '1') {
      return undefined;
    }
    window.sessionStorage.setItem(SUNRISE_KEY, '1');
    // Raise the curtain on the next frame — the dashboard gets one painted
    // frame first (no cascading render), and the dawn fades in over it.
    let hide: number | undefined;
    const raf = window.requestAnimationFrame(() => {
      setMode('sunrise');
      hide = window.setTimeout(
        () => setMode((current) => (current === 'sunrise' ? null : current)),
        SUNRISE_MS,
      );
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (hide !== undefined) window.clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    const onSunset = () => {
      if (prefersReducedMotion()) {
        window.dispatchEvent(new Event(SUNSET_DONE_EVENT));
        return;
      }
      setMode('sunset');
      window.setTimeout(() => window.dispatchEvent(new Event(SUNSET_DONE_EVENT)), SUNSET_MS);
    };
    window.addEventListener(SUNSET_EVENT, onSunset);
    return () => window.removeEventListener(SUNSET_EVENT, onSunset);
  }, []);

  if (!mode) return null;
  const sunrise = mode === 'sunrise';

  return (
    <div
      data-testid="sun-splash"
      data-mode={mode}
      role="status"
      aria-label={sunrise ? t('splash.starting') : t('splash.signingOut')}
      className={`fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden ${
        sunrise ? 'splash-sunrise pointer-events-none' : 'splash-sunset'
      }`}
    >
      <div aria-hidden className="splash-sky absolute inset-0" />
      <div aria-hidden className="relative flex w-full max-w-sm flex-col items-center px-8">
        {/* The sun rises from (or sets behind) the horizon: the stage clips
            everything below its bottom edge, the horizon line sits on it. */}
        <div className="relative flex h-36 w-full items-end justify-center overflow-hidden">
          <div className="splash-glow absolute -bottom-20 size-56 rounded-full" />
          <div className="splash-sun relative -mb-0.5">
            {brand?.logoUrl ? (
              // The org's own logo takes the sun's journey when white-labeled.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="size-14 rounded object-contain" />
            ) : (
              <Sun className="size-14 text-amber-300" strokeWidth={1.5} />
            )}
          </div>
        </div>
        <div className="splash-horizon h-px w-full" />
        <p className="splash-name mt-6 text-2xl font-semibold tracking-tight text-amber-50">
          {brand?.name || t('name')}
        </p>
      </div>
    </div>
  );
}
