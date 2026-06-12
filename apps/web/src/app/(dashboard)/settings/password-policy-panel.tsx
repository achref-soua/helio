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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

/**
 * Org password rotation (M1, owner requirement): on/off plus the interval
 * in days. When on, members with passwords older than the interval are
 * routed to a forced change at sign-in. SSO-only users are unaffected —
 * they have no credential password to rotate.
 */
export function PasswordPolicyPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('passwordPolicy');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draftDays, setDraftDays] = useState<string | null>(null);
  // The tick responds immediately; the server round-trip reconciles it.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const policy = useQuery({
    ...trpc.security.passwordPolicy.queryOptions(),
    enabled: canManage,
  });
  const update = useMutation(trpc.security.updatePasswordPolicy.mutationOptions());

  if (!canManage) return null;
  const enabled = optimistic ?? policy.data?.passwordExpiryEnabled ?? false;
  const days = draftDays ?? String(policy.data?.passwordExpiryDays ?? 90);

  async function save(nextEnabled: boolean) {
    const parsed = Number(days);
    if (!Number.isInteger(parsed) || parsed < 7 || parsed > 365) {
      toast.error(t('badDays'));
      return;
    }
    setOptimistic(nextEnabled);
    try {
      await update.mutateAsync({ enabled: nextEnabled, days: parsed });
      await queryClient.invalidateQueries(trpc.security.passwordPolicy.pathFilter());
      setDraftDays(null);
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    } finally {
      setOptimistic(null);
    }
  }

  return (
    <Card data-testid="password-policy-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={enabled}
            onChange={(event) => void save(event.target.checked)}
          />
          {t('enable')}
        </label>
        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="policy-days">{t('days')}</Label>
            <Input
              id="policy-days"
              type="number"
              min={7}
              max={365}
              className="w-28"
              value={days}
              onChange={(event) => setDraftDays(event.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => void save(enabled)} disabled={update.isPending}>
            {t('save')}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
