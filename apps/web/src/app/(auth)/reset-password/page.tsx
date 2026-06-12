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
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';

import { passwordScore, PasswordStrength } from '@/components/password-strength';
import { authClient } from '@/lib/auth-client';

function ResetPasswordForm() {
  const t = useTranslations('auth.reset');
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      toast.error(error.message ?? t('failed'));
      setPending(false);
      return;
    }
    toast.success(t('done'));
    router.push('/login');
  }

  if (!token) {
    return <p className="text-muted-foreground text-sm">{t('missingToken')}</p>;
  }
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <div className="grid gap-1.5">
        <Label htmlFor="reset-password">{t('newPassword')}</Label>
        <Input
          id="reset-password"
          type="password"
          required
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordStrength password={password} />
      </div>
      <Button type="submit" disabled={pending || passwordScore(password) < 2}>
        {pending ? t('working') : t('save')}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations('auth.reset');
  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-sm" data-testid="reset-password">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
