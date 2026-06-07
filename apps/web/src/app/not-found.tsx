import { Button } from '@helio/ui/components/button';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="grid min-h-svh place-items-center p-6">
      <div className="grid max-w-md gap-4 text-center">
        <h1 className="text-2xl font-semibold">{t('notFoundTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('notFoundBody')}</p>
        <div>
          <Button asChild>
            <Link href="/">{t('backHome')}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
