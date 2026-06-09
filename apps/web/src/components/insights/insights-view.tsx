'use client';

import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { cn } from '@helio/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Target, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SqlExplorer } from '@/components/insights/sql-explorer';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const FIELD_CLASS =
  'border-input bg-transparent dark:bg-input/30 h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

const pct = (value: number) => `${Math.round(value * 100)}%`;

function FunnelReport({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('insights');
  const trpc = useTRPC();
  const [stepsText, setStepsText] = useState('Viewed Pricing, Signed Up, Activated');
  const [windowDays, setWindowDays] = useState(30);
  const [query, setQuery] = useState<{ steps: string[]; windowDays: number } | null>(null);

  const funnel = useQuery({
    ...trpc.analytics.funnel.queryOptions({
      workspaceId,
      steps: query?.steps ?? [],
      windowDays: query?.windowDays ?? 30,
    }),
    enabled: !!query && (query?.steps.length ?? 0) >= 2,
  });

  function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const steps = stepsText
      .split(',')
      .map((step) => step.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (steps.length >= 2) setQuery({ steps, windowDays });
  }

  const rows = funnel.data?.steps ?? [];

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="text-primary size-5" aria-hidden />
          <h2 className="text-lg font-semibold">{t('funnel.title')}</h2>
        </div>
        <p className="text-muted-foreground -mt-2 text-sm">{t('funnel.subtitle')}</p>

        <form onSubmit={run} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="funnel-steps">{t('funnel.steps')}</Label>
            <Input
              id="funnel-steps"
              value={stepsText}
              onChange={(event) => setStepsText(event.target.value)}
              placeholder={t('funnel.stepsPlaceholder')}
              data-testid="funnel-steps"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="funnel-window">{t('funnel.window')}</Label>
            <select
              id="funnel-window"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              className={FIELD_CLASS}
            >
              {[7, 14, 30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {t('funnel.days', { days })}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" data-testid="funnel-run">
            {t('run')}
          </Button>
        </form>

        {funnel.isFetching ? (
          <Skeleton className="h-40" />
        ) : !query ? (
          <p className="text-muted-foreground text-sm">{t('funnel.hint')}</p>
        ) : funnel.data && !funnel.data.clickhouseUp ? (
          <p className="text-muted-foreground text-sm" data-testid="funnel-nodata">
            {t('noClickhouse')}
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="funnel-results">
            {rows.map((step, index) => (
              <li key={`${step.event}-${index}`} className="grid gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{step.event}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {step.reached.toLocaleString()} · {pct(step.rate)}
                    {index > 0 && step.dropoff > 0 ? ` · −${pct(step.dropoff)}` : ''}
                  </span>
                </div>
                <div className="bg-muted h-3 overflow-hidden rounded">
                  <div
                    className="bg-primary h-full rounded"
                    style={{ width: pct(step.rate) }}
                    aria-hidden
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RetentionReport({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('insights');
  const trpc = useTRPC();
  const [weeks, setWeeks] = useState(8);
  const retention = useQuery(trpc.analytics.retention.queryOptions({ workspaceId, weeks }));

  const cohorts = retention.data?.cohorts ?? [];

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex items-center gap-2">
          <Users className="text-primary size-5" aria-hidden />
          <h2 className="text-lg font-semibold">{t('retention.title')}</h2>
          <select
            value={weeks}
            onChange={(event) => setWeeks(Number(event.target.value))}
            className={cn(FIELD_CLASS, 'ml-auto')}
            aria-label={t('retention.weeks')}
            data-testid="retention-weeks"
          >
            {[4, 8, 12, 26].map((value) => (
              <option key={value} value={value}>
                {t('retention.weekCount', { weeks: value })}
              </option>
            ))}
          </select>
        </div>
        <p className="text-muted-foreground -mt-2 text-sm">{t('retention.subtitle')}</p>

        {retention.isLoading ? (
          <Skeleton className="h-40" />
        ) : retention.data && !retention.data.clickhouseUp ? (
          <p className="text-muted-foreground text-sm" data-testid="retention-nodata">
            {t('noClickhouse')}
          </p>
        ) : cohorts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('retention.empty')}</p>
        ) : (
          <div className="overflow-x-auto" data-testid="retention-grid">
            <table className="w-full border-separate border-spacing-1 text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="px-2 py-1 text-left font-medium">{t('retention.cohort')}</th>
                  <th className="px-2 py-1 text-right font-medium">{t('retention.size')}</th>
                  {Array.from({ length: weeks }, (_, index) => (
                    <th key={index} className="px-2 py-1 text-center font-medium">
                      W{index}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((row) => (
                  <tr key={row.cohort}>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">{row.cohort}</td>
                    <td className="text-muted-foreground px-2 py-1 text-right tabular-nums">
                      {row.size.toLocaleString()}
                    </td>
                    {row.retention.map((value, index) => (
                      <td
                        key={index}
                        className="rounded text-center tabular-nums"
                        style={{
                          backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(
                            value * 100,
                          )}%, transparent)`,
                          color: value > 0.5 ? 'var(--primary-foreground)' : 'inherit',
                        }}
                      >
                        {row.size > 0 ? pct(value) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ATTRIBUTION_MODELS = ['first', 'last', 'linear'] as const;

function AttributionReport({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('insights');
  const trpc = useTRPC();
  const [eventName, setEventName] = useState('Order Completed');
  const [model, setModel] = useState<(typeof ATTRIBUTION_MODELS)[number]>('last');
  const [windowDays, setWindowDays] = useState(30);
  const [query, setQuery] = useState<{
    conversionEvent: string;
    model: (typeof ATTRIBUTION_MODELS)[number];
    windowDays: number;
  } | null>(null);

  const attribution = useQuery({
    ...trpc.analytics.attribution.queryOptions({
      workspaceId,
      conversionEvent: query?.conversionEvent ?? '',
      model: query?.model ?? 'last',
      windowDays: query?.windowDays ?? 30,
    }),
    enabled: !!query,
  });

  function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const conversionEvent = eventName.trim();
    if (conversionEvent) setQuery({ conversionEvent, model, windowDays });
  }

  const rows = attribution.data?.rows ?? [];
  const max = rows.reduce((peak, row) => Math.max(peak, row.credit), 0);

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex items-center gap-2">
          <Target className="text-primary size-5" aria-hidden />
          <h2 className="text-lg font-semibold">{t('attribution.title')}</h2>
        </div>
        <p className="text-muted-foreground -mt-2 text-sm">{t('attribution.subtitle')}</p>

        <form onSubmit={run} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="attr-event">{t('attribution.event')}</Label>
            <Input
              id="attr-event"
              value={eventName}
              onChange={(event) => setEventName(event.target.value)}
              placeholder={t('attribution.eventPlaceholder')}
              data-testid="attribution-event"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="attr-model">{t('attribution.model')}</Label>
            <select
              id="attr-model"
              value={model}
              onChange={(event) =>
                setModel(event.target.value as (typeof ATTRIBUTION_MODELS)[number])
              }
              className={FIELD_CLASS}
            >
              {ATTRIBUTION_MODELS.map((value) => (
                <option key={value} value={value}>
                  {t(`attribution.models.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="attr-window">{t('funnel.window')}</Label>
            <select
              id="attr-window"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              className={FIELD_CLASS}
            >
              {[7, 14, 30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {t('funnel.days', { days })}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" data-testid="attribution-run">
            {t('run')}
          </Button>
        </form>

        {attribution.isFetching ? (
          <Skeleton className="h-32" />
        ) : !query ? (
          <p className="text-muted-foreground text-sm">{t('attribution.hint')}</p>
        ) : attribution.data && !attribution.data.clickhouseUp ? (
          <p className="text-muted-foreground text-sm" data-testid="attribution-nodata">
            {t('noClickhouse')}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('attribution.empty')}</p>
        ) : (
          <div className="grid gap-3" data-testid="attribution-results">
            <p className="text-muted-foreground text-xs">
              {t('attribution.converters', { count: attribution.data?.converters ?? 0 })}
            </p>
            <ul className="grid gap-2">
              {rows.map((row) => (
                <li key={row.campaignId} className="grid gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {row.credit.toFixed(1)}
                    </span>
                  </div>
                  <div className="bg-muted h-3 overflow-hidden rounded">
                    <div
                      className="bg-primary h-full rounded"
                      style={{ width: max > 0 ? `${(row.credit / max) * 100}%` : '0%' }}
                      aria-hidden
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function InsightsView() {
  const t = useTranslations('insights');
  const workspaceId = useActiveWorkspaceId();

  if (!workspaceId) return <Skeleton className="h-96" data-testid="insights-loading" />;

  return (
    <div className="grid max-w-4xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <FunnelReport workspaceId={workspaceId} />
      <RetentionReport workspaceId={workspaceId} />
      <AttributionReport workspaceId={workspaceId} />
      <SqlExplorer workspaceId={workspaceId} />
    </div>
  );
}
