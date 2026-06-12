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
import { useMutation } from '@tanstack/react-query';
import { Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { passwordScore, PasswordStrength } from '@/components/password-strength';
import { authClient } from '@/lib/auth-client';
import { useTRPC } from '@/trpc/client';

/**
 * First-run setup (K1): one screen creates the admin (auto-verified — no
 * mail loop exists yet), the organization, and the first workspace, then
 * signs straight in. Email/AI/branding/demo-data all live in Settings,
 * where the dashboard's onboarding checklist points next — the wizard
 * stays short on purpose: a non-technical operator should be inside the
 * product in under a minute.
 */
export function SetupWizard() {
  const t = useTranslations('setup');
  const trpc = useTRPC();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [working, setWorking] = useState(false);
  const bootstrap = useMutation(trpc.setup.bootstrap.mutationOptions());

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    try {
      await bootstrap.mutateAsync({ name, email, password, organizationName });
      const signIn = await authClient.signIn.email({ email, password });
      if (signIn.error) throw new Error(signIn.error.message ?? t('signInFailed'));
      router.push('/');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
      setWorking(false);
    }
  }

  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-md" data-testid="setup-wizard">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sun className="text-primary size-5" aria-hidden /> {t('title')}
          </CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="setup-name">{t('name')}</Label>
              <Input
                id="setup-name"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="setup-email">{t('email')}</Label>
              <Input
                id="setup-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t('emailHint')}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="setup-password">{t('password')}</Label>
              <Input
                id="setup-password"
                type="password"
                required
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <PasswordStrength password={password} />
              <p className="text-muted-foreground text-xs">{t('passwordHint')}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="setup-org">{t('organization')}</Label>
              <Input
                id="setup-org"
                required
                maxLength={120}
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={working || passwordScore(password) < 2}>
              {working ? t('working') : t('start')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('afterNote')}</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
