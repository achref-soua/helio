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
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

export function DashboardOverview() {
  const t = useTranslations('dashboard');
  const trpc = useTRPC();
  const workspaceId = useActiveWorkspaceId();

  const overviewQuery = useQuery({
    ...trpc.analytics.overview.queryOptions({ workspaceId: workspaceId ?? '', days: 14 }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });

  if (!workspaceId || overviewQuery.isLoading) {
    return <Skeleton className="h-64" data-testid="dashboard-loading" />;
  }

  const data = overviewQuery.data;
  const cards = [
    { key: 'contacts', value: data?.contacts ?? 0 },
    { key: 'activeJourneys', value: data?.activeJourneys ?? 0 },
    { key: 'emailsSent', value: data?.sends ?? 0 },
    { key: 'opens', value: data?.opens ?? 0 },
  ] as const;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        {data && !data.clickhouseUp && (
          <Badge variant="outline" className="ml-auto" data-testid="analytics-degraded">
            {t('analyticsDegraded')}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.key} data-testid={`kpi-${card.key}`}>
            <CardHeader>
              <CardDescription>{t(`cards.${card.key}`)}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{card.value.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('timelineTitle')}</CardTitle>
          <CardDescription>{t('timelineSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {data && data.timeline.length > 0 ? (
            <div className="h-64" data-testid="events-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.timeline} margin={{ left: 0, right: 12, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" fontSize={12} tickLine={false} />
                  <YAxis fontSize={12} tickLine={false} allowDecimals={false} width={36} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="events"
                    name={t('series.events')}
                    dot={false}
                    strokeWidth={2}
                    stroke="var(--primary)"
                  />
                  <Line
                    type="monotone"
                    dataKey="opens"
                    name={t('series.opens')}
                    dot={false}
                    strokeWidth={2}
                    stroke="#0ea5e9"
                  />
                  <Line
                    type="monotone"
                    dataKey="clicks"
                    name={t('series.clicks')}
                    dot={false}
                    strokeWidth={2}
                    stroke="#22c55e"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p
              className="text-muted-foreground py-12 text-center text-sm"
              data-testid="chart-empty"
            >
              {data?.clickhouseUp ? t('timelineEmpty') : t('timelineNeedsStack')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
