'use client';

import { SUPPORTED_CURRENCIES } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ThemedSelect } from '@/components/themed-select';
import { useTRPC } from '@/trpc/client';

/**
 * The organization's default currency — what deal amounts and revenue render
 * in across the dashboard, and the default for new deals. Admin-gated; reads
 * and writes the org row through the same branding endpoint.
 */
export function CurrencyPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('currency');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const branding = useQuery({ ...trpc.branding.get.queryOptions(), enabled: canManage });
  const update = useMutation(trpc.branding.update.mutationOptions());
  const [picked, setPicked] = useState<string | null>(null);

  if (!canManage) return null;
  if (branding.isLoading) return <Skeleton className="h-44" data-testid="currency-loading" />;

  const saved = branding.data?.currency ?? 'USD';
  const current = picked ?? saved;

  async function onSave() {
    try {
      await update.mutateAsync({ currency: current });
      toast.success(t('saved'));
      await queryClient.invalidateQueries(trpc.branding.get.pathFilter());
      setPicked(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Card data-testid="currency-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-4" aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid max-w-xs gap-1.5">
          <Label htmlFor="org-currency">{t('label')}</Label>
          <ThemedSelect
            id="org-currency"
            value={current}
            onValueChange={setPicked}
            options={SUPPORTED_CURRENCIES.map((entry) => ({
              value: entry.code,
              label: `${entry.code} — ${entry.label}`,
            }))}
          />
        </div>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
        <div>
          <Button onClick={onSave} disabled={update.isPending || current === saved}>
            {t('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
