'use client';

import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { renderSVG } from 'uqr';

import { SessionsList } from '@/components/sessions-list';
import { authClient, useSession } from '@/lib/auth-client';

type EnrollStep =
  | { step: 'closed' }
  | { step: 'password'; mode: 'enable' | 'disable' }
  | { step: 'verify'; totpURI: string; backupCodes: string[] };

/**
 * Personal account security: TOTP two-factor enrollment. Talks to
 * Better-Auth directly — enabling returns the otpauth URI and backup codes,
 * and 2FA only becomes active once the first code verifies, so a lost
 * QR can never lock the account.
 */
export function SecurityPanel() {
  const t = useTranslations('twoFactor');
  const { data: session, refetch } = useSession();
  const [state, setState] = useState<EnrollStep>({ step: 'closed' });
  const [pending, setPending] = useState(false);

  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled,
  );

  async function onPasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.step !== 'password') return;
    const password = String(new FormData(event.currentTarget).get('password'));
    setPending(true);
    if (state.mode === 'enable') {
      const { data, error } = await authClient.twoFactor.enable({ password });
      setPending(false);
      if (error || !data) {
        toast.error(error?.message ?? t('genericError'));
        return;
      }
      setState({ step: 'verify', totpURI: data.totpURI, backupCodes: data.backupCodes });
    } else {
      const { error } = await authClient.twoFactor.disable({ password });
      setPending(false);
      if (error) {
        toast.error(error.message ?? t('genericError'));
        return;
      }
      toast.success(t('disabled'));
      setState({ step: 'closed' });
      await refetch();
    }
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code'));
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      toast.error(error.message ?? t('badCode'));
      return;
    }
    toast.success(t('enabled'));
    setState({ step: 'closed' });
    await refetch();
  }

  return (
    <Card data-testid="security-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden />
            {t('title')}
            {enabled && (
              <Badge variant="secondary" data-testid="twofa-enabled-badge">
                {t('enabledBadge')}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </div>
        {enabled ? (
          <Button
            variant="outline"
            data-testid="twofa-disable"
            onClick={() => setState({ step: 'password', mode: 'disable' })}
          >
            {t('disableAction')}
          </Button>
        ) : (
          <Button
            data-testid="twofa-enable"
            onClick={() => setState({ step: 'password', mode: 'enable' })}
          >
            {t('enableAction')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-muted-foreground text-sm">{t('body')}</p>
        <SessionsList />
      </CardContent>

      <Dialog
        open={state.step === 'password'}
        onOpenChange={(open) => !open && setState({ step: 'closed' })}
      >
        <DialogContent>
          <form onSubmit={onPasswordSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {state.step === 'password' && state.mode === 'disable'
                  ? t('disableTitle')
                  : t('enableTitle')}
              </DialogTitle>
              <DialogDescription>{t('passwordPrompt')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="twofa-password">{t('password')}</Label>
              <Input
                id="twofa-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                data-testid="twofa-password"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending} data-testid="twofa-continue">
                {pending ? t('working') : t('continue')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={state.step === 'verify'}
        onOpenChange={(open) => !open && setState({ step: 'closed' })}
      >
        <DialogContent>
          <form onSubmit={onVerify} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('scanTitle')}</DialogTitle>
              <DialogDescription>{t('scanBody')}</DialogDescription>
            </DialogHeader>
            {state.step === 'verify' && (
              <>
                <div className="flex justify-center">
                  <div
                    className="size-44 rounded-md bg-white p-2 [&>svg]:size-full"
                    data-testid="twofa-qr"
                    aria-label={t('qrAlt')}
                    role="img"
                    // uqr renders a self-contained, data-derived SVG string.
                    dangerouslySetInnerHTML={{ __html: renderSVG(state.totpURI) }}
                  />
                </div>
                <p className="text-muted-foreground break-all text-center font-mono text-xs">
                  <span data-testid="twofa-uri">{state.totpURI}</span>
                </p>
                <div className="grid gap-2">
                  <Label>{t('backupCodes')}</Label>
                  <p className="text-muted-foreground text-xs">{t('backupCodesBody')}</p>
                  <div
                    className="bg-muted grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-xs"
                    data-testid="twofa-backup-codes"
                  >
                    {state.backupCodes.map((code) => (
                      <span key={code}>{code}</span>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="twofa-code">{t('codeLabel')}</Label>
                  <Input
                    id="twofa-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    data-testid="twofa-code"
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending} data-testid="twofa-verify">
                {pending ? t('working') : t('verifyAction')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
