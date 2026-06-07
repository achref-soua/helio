import { Sun } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('app');
  return (
    <main className="grid min-h-svh place-items-center p-6">
      <div className="grid w-full max-w-sm gap-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <Sun className="text-primary size-6" aria-hidden />
          {t('name')}
        </div>
        {children}
      </div>
    </main>
  );
}
