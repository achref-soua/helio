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
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { passwordScore, PasswordStrength } from '@/components/password-strength';
import { authClient } from '@/lib/auth-client';

/**
 * Forced password rotation (M1, owner requirement): the dashboard layout
 * sends expired-password users here; the only ways out are a new
 * password or signing out. Other sessions are revoked on change.
 */
export default function ChangePasswordPage() {
  const t = useTranslations('auth.change');
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (error) {
      toast.error(error.message ?? t('failed'));
      setPending(false);
      return;
    }
    toast.success(t('done'));
    router.push('/');
    router.refresh();
  }

  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-sm" data-testid="change-password">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="current-password">{t('current')}</Label>
              <Input
                id="current-password"
                type="password"
                required
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-password">{t('new')}</Label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={10}
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
              <PasswordStrength password={next} />
            </div>
            <Button type="submit" disabled={pending || passwordScore(next) < 2}>
              {pending ? t('working') : t('save')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await authClient.signOut();
                router.push('/login');
              }}
            >
              {t('signOutInstead')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
