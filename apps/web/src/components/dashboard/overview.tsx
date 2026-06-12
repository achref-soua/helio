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
import { MailOpen, Send, Users, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_AXIS, ChartGradients, ChartTooltip } from '@/components/charts';
import { PageHeader } from '@/components/page-header';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const KPI_ICONS = {
  contacts: Users,
  activeJourneys: Workflow,
  emailsSent: Send,
  opens: MailOpen,
} as const;

const TIMELINE_SERIES = [
  { key: 'events', color: 'var(--chart-1)', gradient: 'dash-events' },
  { key: 'opens', color: 'var(--chart-2)', gradient: 'dash-opens' },
  { key: 'clicks', color: 'var(--chart-4)', gradient: 'dash-clicks' },
] as const;

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
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          data && !data.clickhouseUp ? (
            <Badge variant="outline" data-testid="analytics-degraded">
              {t('analyticsDegraded')}
            </Badge>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = KPI_ICONS[card.key];
          return (
            <Card key={card.key} className="gap-3" data-testid={`kpi-${card.key}`}>
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="text-xs font-medium tracking-wider uppercase">
                    {t(`cards.${card.key}`)}
                  </span>
                </CardDescription>
                <CardTitle className="font-display pt-1 text-4xl font-semibold tabular-nums">
                  {card.value.toLocaleString()}
                </CardTitle>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('timelineTitle')}</CardTitle>
          <CardDescription>{t('timelineSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {data && data.timeline.length > 0 ? (
            <div className="h-72" data-testid="events-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeline} margin={{ left: 0, right: 12, top: 8 }}>
                  <ChartGradients
                    series={TIMELINE_SERIES.map(({ gradient, color }) => ({
                      id: gradient,
                      color,
                    }))}
                  />
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="day" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} allowDecimals={false} width={36} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                  <Legend
                    iconType="circle"
                    iconSize={7}
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                  {TIMELINE_SERIES.map(({ key, color, gradient }) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={t(`series.${key}`)}
                      stroke={color}
                      strokeWidth={2.25}
                      fill={`url(#${gradient})`}
                      dot={false}
                      activeDot={{ r: 3.5, strokeWidth: 0 }}
                    />
                  ))}
                </AreaChart>
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
