'use client';

import {
  type DashboardLayout,
  type DashboardWidgetId,
  dashboardWidgetSize,
  defaultDashboardLayout,
} from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Skeleton } from '@helio/ui/components/skeleton';
import { cn } from '@helio/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  EyeOff,
  Handshake,
  Layers,
  LayoutGrid,
  ListTodo,
  type LucideIcon,
  MailOpen,
  Megaphone,
  Plus,
  Send,
  SlidersHorizontal,
  Users,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
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
import { toast } from 'sonner';

import { CHART_AXIS, ChartGradients, ChartTooltip, MeterBar } from '@/components/charts';
import { PageHeader } from '@/components/page-header';
import { ThemedSelect } from '@/components/themed-select';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const TIMELINE_SERIES = [
  { key: 'events', color: 'var(--chart-1)', gradient: 'dash-events' },
  { key: 'opens', color: 'var(--chart-2)', gradient: 'dash-opens' },
  { key: 'clicks', color: 'var(--chart-4)', gradient: 'dash-clicks' },
] as const;

const QUICK_LINKS = [
  { href: '/contacts', key: 'contacts' },
  { href: '/segments', key: 'segments' },
  { href: '/campaigns', key: 'campaigns' },
  { href: '/journeys', key: 'journeys' },
  { href: '/emails', key: 'emails' },
  { href: '/forms', key: 'forms' },
  { href: '/landing', key: 'landing' },
  { href: '/widgets', key: 'widgets' },
  { href: '/in-app', key: 'inApp' },
  { href: '/deals', key: 'deals' },
  { href: '/tasks', key: 'tasks' },
  { href: '/insights', key: 'insights' },
] as const;

export function DashboardOverview() {
  const t = useTranslations('dashboard');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [days, setDays] = useState(14);
  // Edit mode holds a local draft so reorder/hide is instant; null = not editing.
  const [draft, setDraft] = useState<DashboardLayout | null>(null);

  const layoutQuery = useQuery(trpc.dashboard.layout.queryOptions());
  const overviewQuery = useQuery({
    ...trpc.analytics.overview.queryOptions({ workspaceId: workspaceId ?? '', days }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
  const metricsQuery = useQuery({
    ...trpc.dashboard.metrics.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
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
  const setLayout = useMutation(trpc.dashboard.setLayout.mutationOptions());

  if (!workspaceId || overviewQuery.isLoading || layoutQuery.isLoading) {
    return <Skeleton className="h-64" data-testid="dashboard-loading" />;
  }

  const layout = draft ?? layoutQuery.data ?? defaultDashboardLayout();
  const data = overviewQuery.data;
  const editing = draft !== null;

  const context: WidgetContext = {
    t,
    days,
    overview: data ?? null,
    metrics: metricsQuery.data ?? null,
    board: boardQuery.data ?? null,
    campaigns: campaignsQuery.data ?? [],
    engagement: engagementQuery.data?.byCampaign ?? {},
  };

  // ── Edit-mode mutations on the local draft ───────────────────────────────
  function updateDraft(next: DashboardLayout) {
    setDraft(next);
  }
  function move(id: DashboardWidgetId, direction: -1 | 1) {
    const index = layout.findIndex((w) => w.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= layout.length) return;
    const next = [...layout];
    [next[index], next[target]] = [next[target]!, next[index]!];
    updateDraft(next);
  }
  function setVisible(id: DashboardWidgetId, visible: boolean) {
    updateDraft(layout.map((w) => (w.id === id ? { ...w, visible } : w)));
  }

  async function onSave() {
    if (!draft) return;
    try {
      await setLayout.mutateAsync({ layout: draft });
      await queryClient.invalidateQueries(trpc.dashboard.layout.pathFilter());
      setDraft(null);
      toast.success(t('layoutSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('layoutError'));
    }
  }

  const hidden = layout.filter((w) => !w.visible);

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
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={setLayout.isPending}
                  data-testid="dashboard-save"
                >
                  <Check aria-hidden /> {t('done')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDraft(layout)}
                data-testid="dashboard-customize"
              >
                <SlidersHorizontal aria-hidden /> {t('customize')}
              </Button>
            )}
          </>
        }
      />

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="dashboard-grid"
      >
        {layout
          .filter((w) => w.visible)
          .map((w) => (
            <WidgetFrame
              key={w.id}
              id={w.id}
              editing={editing}
              t={t}
              onUp={() => move(w.id, -1)}
              onDown={() => move(w.id, 1)}
              onHide={() => setVisible(w.id, false)}
            >
              {renderWidget(w.id, context)}
            </WidgetFrame>
          ))}
      </div>

      {editing && (
        <Card data-testid="dashboard-hidden">
          <CardHeader>
            <CardTitle className="text-base">{t('addWidgets')}</CardTitle>
            <CardDescription>{t('addWidgetsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {hidden.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('allShown')}</p>
            ) : (
              hidden.map((w) => (
                <Button
                  key={w.id}
                  variant="outline"
                  size="sm"
                  onClick={() => setVisible(w.id, true)}
                  data-testid={`widget-${w.id}-add`}
                >
                  <Plus aria-hidden /> {t(`widgets.${w.id}`)}
                </Button>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Wraps a widget; in edit mode adds a reorder/hide toolbar and a span class. */
function WidgetFrame({
  id,
  editing,
  t,
  onUp,
  onDown,
  onHide,
  children,
}: {
  id: DashboardWidgetId;
  editing: boolean;
  t: ReturnType<typeof useTranslations>;
  onUp: () => void;
  onDown: () => void;
  onHide: () => void;
  children: ReactNode;
}) {
  const span = dashboardWidgetSize(id) === 'large' ? 'sm:col-span-2 xl:col-span-4' : '';
  return (
    <div className={cn('grid gap-2', span)} data-testid={`widget-${id}`}>
      {editing && (
        <div className="bg-muted/40 flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
          <span className="font-medium">{t(`widgets.${id}`)}</span>
          <div className="ml-auto flex gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t('moveUp')}
              onClick={onUp}
              data-testid={`widget-${id}-up`}
            >
              <ArrowUp className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t('moveDown')}
              onClick={onDown}
              data-testid={`widget-${id}-down`}
            >
              <ArrowDown className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t('hide')}
              onClick={onHide}
              data-testid={`widget-${id}-hide`}
            >
              <EyeOff className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

interface WidgetContext {
  t: ReturnType<typeof useTranslations>;
  days: number;
  overview: {
    contacts: number;
    activeJourneys: number;
    sends: number;
    opens: number;
    clickhouseUp: boolean;
    timeline: Array<Record<string, number | string>>;
  } | null;
  metrics: {
    tasksOpen: number;
    lists: number;
    segments: number;
    forms: number;
    landingPages: number;
    widgets: number;
    inAppMessages: number;
  } | null;
  board: {
    stages: Array<{ deals: Array<{ status: string; valueCents: number; currency: string }> }>;
  } | null;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    sentAt: string | Date | null;
    sendCounts: Record<string, number>;
  }>;
  engagement: Record<string, { uniqueOpens: number; clicks: number }>;
}

const STAT_ICONS: Record<string, LucideIcon> = {
  contacts: Users,
  activeJourneys: Workflow,
  emailsSent: Send,
  opens: MailOpen,
  openDeals: Handshake,
  tasksDue: ListTodo,
};

function renderWidget(id: DashboardWidgetId, ctx: WidgetContext): ReactNode {
  const { t, overview, metrics, board } = ctx;
  switch (id) {
    case 'contacts':
      return <StatCard id={id} value={overview?.contacts ?? 0} href="/contacts" t={t} />;
    case 'activeJourneys':
      return <StatCard id={id} value={overview?.activeJourneys ?? 0} href="/journeys" t={t} />;
    case 'emailsSent':
      return <StatCard id={id} value={overview?.sends ?? 0} href="/campaigns" t={t} />;
    case 'opens':
      return <StatCard id={id} value={overview?.opens ?? 0} t={t} />;
    case 'openDeals': {
      const open = (board?.stages ?? [])
        .flatMap((stage) => stage.deals)
        .filter((deal) => deal.status === 'OPEN');
      return <StatCard id={id} value={open.length} href="/deals" t={t} />;
    }
    case 'tasksDue':
      return <StatCard id={id} value={metrics?.tasksOpen ?? 0} href="/tasks" t={t} />;
    case 'timeline':
      return <TimelineCard ctx={ctx} />;
    case 'pipeline':
      return <PipelineCard board={board} />;
    case 'recentCampaigns':
      return <RecentCampaignsCard campaigns={ctx.campaigns} engagement={ctx.engagement} />;
    case 'audience':
      return <AudienceCard ctx={ctx} />;
    case 'channels':
      return <ChannelsCard metrics={metrics} t={t} />;
    case 'quickLinks':
      return <QuickLinksCard t={t} />;
  }
}

function StatCard({
  id,
  value,
  href,
  t,
}: {
  id: DashboardWidgetId;
  value: number;
  href?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const Icon = STAT_ICONS[id] ?? Users;
  const inner = (
    <Card className="gap-3 transition-shadow hover:shadow-md" data-testid={`kpi-${id}`}>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
            <Icon className="size-3.5" aria-hidden />
          </span>
          <span className="text-xs font-medium tracking-wider uppercase">{t(`cards.${id}`)}</span>
        </CardDescription>
        <CardTitle className="font-display pt-1 text-4xl font-semibold tabular-nums">
          {value.toLocaleString()}
        </CardTitle>
      </CardHeader>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function TimelineCard({ ctx }: { ctx: WidgetContext }) {
  const { t, overview } = ctx;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('timelineTitle')}</CardTitle>
        <CardDescription>{t('timelineSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {overview && overview.timeline.length > 0 ? (
          <div className="h-72" data-testid="events-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overview.timeline} margin={{ left: 0, right: 12, top: 8 }}>
                <ChartGradients
                  series={TIMELINE_SERIES.map(({ gradient, color }) => ({ id: gradient, color }))}
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
          <p className="text-muted-foreground py-12 text-center text-sm" data-testid="chart-empty">
            {overview?.clickhouseUp ? t('timelineEmpty') : t('timelineNeedsStack')}
          </p>
        )}
      </CardContent>
    </Card>
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
    stages: Array<{ deals: Array<{ status: string; valueCents: number; currency: string }> }>;
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
  campaigns: WidgetContext['campaigns'];
  engagement: WidgetContext['engagement'];
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

/** Audience at a glance — contacts, lists, segments. */
function AudienceCard({ ctx }: { ctx: WidgetContext }) {
  const { t, overview, metrics } = ctx;
  const stats = [
    { key: 'audienceContacts', value: overview?.contacts ?? 0 },
    { key: 'audienceLists', value: metrics?.lists ?? 0 },
    { key: 'audienceSegments', value: metrics?.segments ?? 0 },
  ] as const;
  return (
    <Card data-testid="dashboard-audience">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
            <Layers className="size-3.5" aria-hidden />
          </span>
          {t('audienceTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        {stats.map((item) => (
          <div key={item.key} className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {t(item.key)}
            </span>
            <span className="font-display text-2xl font-semibold tabular-nums">
              {item.value.toLocaleString()}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Engagement channels — forms, landing pages, widgets, in-app messages. */
function ChannelsCard({
  metrics,
  t,
}: {
  metrics: WidgetContext['metrics'];
  t: ReturnType<typeof useTranslations>;
}) {
  const stats = [
    { key: 'channelsForms', value: metrics?.forms ?? 0, href: '/forms' },
    { key: 'channelsLanding', value: metrics?.landingPages ?? 0, href: '/landing' },
    { key: 'channelsWidgets', value: metrics?.widgets ?? 0, href: '/widgets' },
    { key: 'channelsInApp', value: metrics?.inAppMessages ?? 0, href: '/in-app' },
  ] as const;
  return (
    <Card data-testid="dashboard-channels">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
            <LayoutGrid className="size-3.5" aria-hidden />
          </span>
          {t('channelsTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="grid gap-1 rounded-md p-2 hover:bg-muted/50"
          >
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {t(item.key)}
            </span>
            <span className="font-display text-2xl font-semibold tabular-nums">
              {item.value.toLocaleString()}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/** Jump-to shortcuts across every feature. */
function QuickLinksCard({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <Card data-testid="dashboard-quicklinks">
      <CardHeader>
        <CardTitle className="text-base">{t('quickLinksTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="border-input hover:bg-muted/60 rounded-md border px-3 py-1.5 text-sm"
          >
            {t(`quickLinks.${link.key}`)}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
