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
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

/**
 * Settings → Maintenance: where in-app bug reports go. Admin sets the GitHub
 * repo and an optional PAT (sealed); reports become issues there.
 */
export function SupportPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('support');
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const config = useQuery({ ...trpc.support.config.queryOptions(), enabled: canManage });
  const configure = useMutation(trpc.support.configure.mutationOptions());

  const [seeded, setSeeded] = useState(false);
  const [repo, setRepo] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');

  const cfg = config.data;
  if (cfg && !seeded) {
    setSeeded(true);
    // Only seed a field when the org has overridden the deployment default.
    setRepo(cfg.custom ? cfg.repoSlug : '');
    setEmail(cfg.customEmail ? cfg.notifyEmail : '');
  }

  async function onSave() {
    try {
      await configure.mutateAsync({
        repo: repo.trim(),
        email: email.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
      });
      await queryClient.invalidateQueries(trpc.support.config.pathFilter());
      setToken('');
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onRemoveToken() {
    try {
      await configure.mutateAsync({ token: null });
      await queryClient.invalidateQueries(trpc.support.config.pathFilter());
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Card data-testid="support-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="size-4" aria-hidden />
          {t('panelTitle')}
        </CardTitle>
        <CardDescription>{t('panelSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-4">
        <div className="grid gap-2">
          <Label htmlFor="support-repo">{t('repoLabel')}</Label>
          <Input
            id="support-repo"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder={cfg?.repoSlug ?? 'owner/name'}
            spellCheck={false}
            data-testid="support-repo"
          />
          <p className="text-muted-foreground text-xs">
            {t('repoHint', { repo: cfg?.repoSlug ?? '' })}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="support-email">{t('emailLabel')}</Label>
          <Input
            id="support-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={cfg?.notifyEmail ?? 'support@example.com'}
            autoComplete="off"
            spellCheck={false}
            data-testid="support-email"
          />
          <p className="text-muted-foreground text-xs">
            {t('emailHint', { email: cfg?.notifyEmail ?? '' })}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="support-token">{t('tokenLabel')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="support-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={cfg?.hasToken ? '••••••••' : 'ghp_…'}
              autoComplete="off"
              spellCheck={false}
              data-testid="support-token"
            />
            {cfg?.hasToken && (
              <Badge variant="secondary" className="shrink-0">
                {t('tokenConfigured')}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">{t('tokenHint')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onSave} disabled={configure.isPending} data-testid="support-save">
            {t('saveTarget')}
          </Button>
          {cfg?.hasToken && (
            <Button variant="ghost" onClick={onRemoveToken} disabled={configure.isPending}>
              {t('removeToken')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
