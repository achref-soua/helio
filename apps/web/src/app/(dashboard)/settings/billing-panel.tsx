'use client';

import { Badge } from '@helio/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Skeleton } from '@helio/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { useTRPC } from '@/trpc/client';

export function BillingPanel() {
  const t = useTranslations('billing');
  const trpc = useTRPC();
  const billing = useQuery(trpc.billing.get.queryOptions({}));

  if (billing.isLoading) {
    return <Skeleton className="h-40" data-testid="billing-loading" />;
  }
  if (!billing.data) return null;

  const { plan, contactLimit, contactUsage, status, priceCents } = billing.data;
  const pct =
    contactLimit && contactLimit > 0
      ? Math.min(100, Math.round((contactUsage / contactLimit) * 100))
      : 0;
  const near = contactLimit !== null && contactUsage / contactLimit >= 0.9;

  return (
    <Card data-testid="billing-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {t('title')}
          <Badge
            variant={plan === 'UNLIMITED' ? 'outline' : 'secondary'}
            data-testid="billing-plan"
          >
            {t(`plans.${plan}`)}
          </Badge>
          {status && <Badge variant="outline">{status}</Badge>}
        </CardTitle>
        <CardDescription>
          {contactLimit === null
            ? t('selfHosted')
            : t('priced', { price: (priceCents / 100).toFixed(0) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('contactsUsage')}</span>
          <span className="tabular-nums" data-testid="billing-usage">
            {contactLimit === null
              ? t('usageUnlimited', { count: contactUsage })
              : t('usageOf', { count: contactUsage, limit: contactLimit })}
          </span>
        </div>
        {contactLimit !== null && (
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className={near ? 'bg-destructive h-full' : 'bg-primary h-full'}
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('contactsUsage')}
            />
          </div>
        )}
        {near && <p className="text-destructive text-xs">{t('nearLimit')}</p>}
      </CardContent>
    </Card>
  );
}
