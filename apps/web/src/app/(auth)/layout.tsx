import { Sun } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { ThemeToggle } from '@/components/theme-toggle';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('app');
  return (
    <main className="bg-radiant relative grid min-h-svh place-items-center p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="grid w-full max-w-sm gap-6">
        <div className="font-display flex items-center justify-center gap-2.5 text-2xl font-semibold tracking-tight">
          <span className="relative inline-flex" aria-hidden>
            <Sun className="text-primary size-6" />
            <span className="bg-primary/30 absolute inset-0 -z-10 rounded-full blur-md" />
          </span>
          {t('name')}
        </div>
        {children}
      </div>
    </main>
  );
}
