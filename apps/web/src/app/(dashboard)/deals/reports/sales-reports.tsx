'use client';

import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

/**
 * Sales reports (H5): pipeline value by stage, win rate, average cycle,
 * a deliberately simple forecast (open value × win rate — labeled as
 * such), and the owner leaderboard. Pure Postgres; loads on the core
 * profile with nothing else running.
 */
export function SalesReports() {
  const t = useTranslations('salesReports');
  const trpc = useTRPC();
  const workspaceId = useActiveWorkspaceId();
  const report = useQuery({
    ...trpc.crm.salesReport.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: Boolean(workspaceId),
  });

  const data = report.data;
  const money = (cents: number) =>
    (cents / 100).toLocaleString(undefined, {
      style: 'currency',
      currency: data?.currency ?? 'USD',
    });

  return (
    <div className="grid max-w-4xl grid-cols-1 gap-4" data-testid="sales-reports">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/deals" aria-label={t('back')}>
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card data-testid="sales-winrate">
          <CardHeader>
            <CardTitle className="text-base">{t('winRate')}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {data?.winRate === null || data?.winRate === undefined
              ? '—'
              : `${Math.round(data.winRate * 100)}%`}
          </CardContent>
        </Card>
        <Card data-testid="sales-cycle">
          <CardHeader>
            <CardTitle className="text-base">{t('avgCycle')}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {data?.avgCycleDays === null || data?.avgCycleDays === undefined
              ? '—'
              : t('days', { days: Math.round(data.avgCycleDays * 10) / 10 })}
          </CardContent>
        </Card>
        <Card data-testid="sales-forecast">
          <CardHeader>
            <CardTitle className="text-base">{t('forecast')}</CardTitle>
            <CardDescription>{t('forecastHint')}</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {data?.forecastCents === null || data?.forecastCents === undefined
              ? '—'
              : money(data.forecastCents)}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="sales-by-stage">
          <CardHeader>
            <CardTitle>{t('byStage')}</CardTitle>
            <CardDescription>{t('byStageHint')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="px-4 py-2 font-medium">{t('stage')}</th>
                  <th className="px-4 py-2 font-medium">{t('deals')}</th>
                  <th className="px-4 py-2 font-medium">{t('value')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byStage ?? []).map((row) => (
                  <tr key={row.stage} className="border-b last:border-0">
                    <td className="px-4 py-2">{row.stage}</td>
                    <td className="px-4 py-2 tabular-nums">{row.count}</td>
                    <td className="px-4 py-2 tabular-nums">{money(row.valueCents)}</td>
                  </tr>
                ))}
                {(data?.byStage ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-muted-foreground px-4 py-6 text-center">
                      {t('empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card data-testid="sales-leaderboard">
          <CardHeader>
            <CardTitle>{t('leaderboard')}</CardTitle>
            <CardDescription>{t('leaderboardHint')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="px-4 py-2 font-medium">{t('owner')}</th>
                  <th className="px-4 py-2 font-medium">{t('won')}</th>
                  <th className="px-4 py-2 font-medium">{t('value')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.leaderboard ?? []).map((row) => (
                  <tr key={row.owner ?? 'unassigned'} className="border-b last:border-0">
                    <td className="px-4 py-2">{row.owner ?? t('unassigned')}</td>
                    <td className="px-4 py-2 tabular-nums">{row.wonCount}</td>
                    <td className="px-4 py-2 tabular-nums">{money(row.wonCents)}</td>
                  </tr>
                ))}
                {(data?.leaderboard ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-muted-foreground px-4 py-6 text-center">
                      {t('noWins')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
