'use client';

import { Button } from '@helio/ui/components/button';
import { useTranslations } from 'next-intl';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  return (
    <main className="grid min-h-svh place-items-center p-6">
      <div className="grid max-w-md gap-4 text-center">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
        <div>
          <Button onClick={reset}>{t('retry')}</Button>
        </div>
      </div>
    </main>
  );
}
