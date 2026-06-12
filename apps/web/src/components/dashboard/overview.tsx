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
import { Handshake, MailOpen, Megaphone, Send, Users, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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

import { CHART_AXIS, ChartGradients, ChartTooltip, MeterBar } from '@/components/charts';
import { PageHeader } from '@/components/page-header';
import { ThemedSelect } from '@/components/themed-select';
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

  // The window is the operator's choice — customization over defaults.
  const [days, setDays] = useState(14);
  const overviewQuery = useQuery({
    ...trpc.analytics.overview.queryOptions({ workspaceId: workspaceId ?? '', days }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
  const boardQuery = useQuery({
    ...trpc.crm.board.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  const campaignsQuery = useQuery({
    ...trpc.campaign.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  const engagementQuery = useQuery({
    ...trpc.analytics.campaignEngagement.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
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
          <>
            {data && !data.clickhouseUp && (
              <Badge variant="outline" data-testid="analytics-degraded">
                {t('analyticsDegraded')}
              </Badge>
            )}
            <ThemedSelect
              aria-label={t('rangeLabel')}
              value={String(days)}
              onValueChange={(value) => setDays(Number(value))}
              size="sm"
              options={[7, 14, 30, 90].map((value) => ({
                value: String(value),
                label: t('rangeDays', { days: value }),
              }))}
            />
          </>
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

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PipelineCard board={boardQuery.data ?? null} />
        <RecentCampaignsCard
          campaigns={campaignsQuery.data ?? []}
          engagement={engagementQuery.data?.byCampaign ?? {}}
        />
      </div>
    </div>
  );
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${Math.round(cents / 100)} ${currency}`;
  }
}

/** The sales pipeline at a glance — open deals, open value, value won. */
function PipelineCard({
  board,
}: {
  board: {
    stages: Array<{
      deals: Array<{ status: string; valueCents: number; currency: string }>;
    }>;
  } | null;
}) {
  const t = useTranslations('dashboard');
  if (!board) return null;
  const deals = board.stages.flatMap((stage) => stage.deals);
  const open = deals.filter((deal) => deal.status === 'OPEN');
  const wonValue = deals
    .filter((deal) => deal.status === 'WON')
    .reduce((sum, deal) => sum + deal.valueCents, 0);
  const openValue = open.reduce((sum, deal) => sum + deal.valueCents, 0);
  const currency = deals[0]?.currency ?? 'USD';
  return (
    <Card data-testid="dashboard-pipeline">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
            <Handshake className="size-3.5" aria-hidden />
          </span>
          {t('pipelineTitle')}
        </CardTitle>
        <CardDescription>
          <Link href="/deals" className="underline-offset-4 hover:underline">
            {t('pipelineLink')}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4">
        {(
          [
            { key: 'pipelineOpenDeals', value: String(open.length) },
            { key: 'pipelineOpenValue', value: money(openValue, currency) },
            { key: 'pipelineWonValue', value: money(wonValue, currency) },
          ] as const
        ).map((item) => (
          <div key={item.key} className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {t(item.key)}
            </span>
            <span className="font-display text-2xl font-semibold tabular-nums">{item.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** The last sent campaigns with their live engagement, as meters. */
function RecentCampaignsCard({
  campaigns,
  engagement,
}: {
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    sentAt: string | Date | null;
    sendCounts: Record<string, number>;
  }>;
  engagement: Record<string, { uniqueOpens: number; clicks: number }>;
}) {
  const t = useTranslations('dashboard');
  const sent = campaigns.filter((campaign) => campaign.status === 'SENT').slice(0, 4);
  return (
    <Card data-testid="dashboard-campaigns">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
            <Megaphone className="size-3.5" aria-hidden />
          </span>
          {t('recentCampaignsTitle')}
        </CardTitle>
        <CardDescription>
          <Link href="/campaigns" className="underline-offset-4 hover:underline">
            {t('recentCampaignsLink')}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {sent.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('recentCampaignsEmpty')}</p>
        ) : (
          sent.map((campaign) => {
            const sends = campaign.sendCounts.SENT ?? 0;
            const stats = engagement[campaign.id];
            const openRate = sends > 0 && stats ? stats.uniqueOpens / sends : 0;
            return (
              <div key={campaign.id} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{campaign.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t('campaignNumbers', {
                      sends,
                      opens: stats?.uniqueOpens ?? 0,
                      clicks: stats?.clicks ?? 0,
                    })}
                  </span>
                </div>
                <MeterBar ratio={openRate} />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
