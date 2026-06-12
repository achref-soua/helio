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
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

/**
 * Forgot password (M1): always answers the same way, whether or not the
 * address exists — a different reply would confirm accounts to strangers.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgot');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    await authClient
      .requestPasswordReset({ email, redirectTo: '/reset-password' })
      .catch(() => undefined);
    setSent(true);
    setPending(false);
  }

  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-sm" data-testid="forgot-password">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-muted-foreground text-sm" data-testid="forgot-sent">
              {t('sent')}
            </p>
          ) : (
            <form className="grid gap-4" onSubmit={onSubmit}>
              <div className="grid gap-1.5">
                <Label htmlFor="forgot-email">{t('email')}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? t('working') : t('send')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
