'use client';

import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Separator } from '@helio/ui/components/separator';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { signIn } from '@/lib/auth-client';

export function LoginForm({ showSignup }: { showSignup: boolean }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [ssoPending, setSsoPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    const { data, error } = await signIn.email({
      email,
      password: String(form.get('password')),
    });
    setPending(false);
    if (error) {
      toast.error(error.message ?? t('genericError'));
      return;
    }
    // Accounts with TOTP enabled get a partial session and finish on the
    // challenge page instead of the dashboard.
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      router.push('/two-factor');
      return;
    }
    router.push('/');
    router.refresh();
  }

  // Single sign-on: the email's domain selects the org's IdP, then we hand
  // off to it. Better-Auth completes the round-trip back to callbackURL.
  async function onSso() {
    if (!email) {
      toast.error(t('ssoEmailRequired'));
      return;
    }
    setSsoPending(true);
    const { error } = await signIn.sso({ email, callbackURL: '/' });
    setSsoPending(false);
    if (error) {
      toast.error(error.message ?? t('ssoNoProvider'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('loginTitle')}</CardTitle>
        <CardDescription>{t('loginSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? t('working') : t('loginAction')}
          </Button>
          <div className="flex items-center gap-3" aria-hidden>
            <Separator className="flex-1" />
            <span className="text-muted-foreground text-xs uppercase">{t('or')}</span>
            <Separator className="flex-1" />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onSso}
            disabled={ssoPending}
            data-testid="sso-login"
          >
            {ssoPending ? t('working') : t('ssoAction')}
          </Button>
          {showSignup && (
            <p className="text-muted-foreground text-center text-sm">
              {t('noAccount')}{' '}
              <Link className="underline underline-offset-4" href="/signup">
                {t('signupAction')}
              </Link>
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
