import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { authDb } from '@/lib/auth';
import { env } from '@/lib/env';

import { SignupForm } from './signup-form';

export default async function SignupPage() {
  // A brand-new install goes to first-run setup instead.
  if ((await authDb.user.count()) === 0) redirect('/setup');
  if (!env.ALLOW_PUBLIC_SIGNUP) {
    const t = await getTranslations('auth');
    return (
      <div className="grid min-h-svh place-items-center p-4">
        <div className="grid max-w-sm gap-3 text-center" data-testid="signup-disabled">
          <h1 className="text-xl font-semibold">{t('inviteOnlyTitle')}</h1>
          <p className="text-muted-foreground text-sm">{t('inviteOnlyBody')}</p>
          <Link href="/login" className="text-sm underline underline-offset-4">
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    );
  }
  return <SignupForm />;
}
