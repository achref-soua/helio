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

import { authClient } from '@/lib/auth-client';

/**
 * The second factor of sign-in. Reached only mid-login (the partial 2FA
 * cookie authorizes the verify calls); refreshing or landing here cold just
 * sends the visitor back to /login on the first failed verify.
 */
export default function TwoFactorPage() {
  const t = useTranslations('twoFactor');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code')).trim();
    setPending(true);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);
    if (error) {
      toast.error(error.message ?? t('badCode'));
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('challengeTitle')}</CardTitle>
        <CardDescription>{useBackup ? t('backupPrompt') : t('challengeBody')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="code">{useBackup ? t('backupCodeLabel') : t('codeLabel')}</Label>
            <Input
              id="code"
              name="code"
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              required
              data-testid="twofa-challenge-code"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={trustDevice}
              onChange={(event) => setTrustDevice(event.target.checked)}
            />
            {t('trustDevice')}
          </label>
          <Button type="submit" disabled={pending} data-testid="twofa-challenge-verify">
            {pending ? t('working') : t('verifyAction')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-testid="twofa-use-backup"
            onClick={() => setUseBackup((value) => !value)}
          >
            {useBackup ? t('useTotpInstead') : t('useBackupInstead')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
