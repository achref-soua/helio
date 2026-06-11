'use client';

import { csvDocument } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useTRPC } from '@/trpc/client';

/**
 * Organization-wide reports (G4): send volume, contact growth, journey
 * outcomes, campaign engagement, member activity. Postgres-first — the
 * engagement card states plainly when the analytics store is off instead
 * of hiding or erroring.
 */

function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const href = URL.createObjectURL(new Blob([csvDocument(header, rows)], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

const PERIODS = [30, 60, 90] as const;

export function ReportsView() {
  const t = useTranslations('admin.reports');
  const trpc = useTRPC();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);

  const activity = useQuery(trpc.admin.reportActivity.queryOptions({ days }));
  const journeys = useQuery(trpc.admin.reportJourneys.queryOptions());
  const campaigns = useQuery(trpc.admin.reportCampaigns.queryOptions());
  const members = useQuery(trpc.admin.reportMembers.queryOptions());

  return (
    <div className="grid gap-4" data-testid="reports-view">
      <div className="flex items-center gap-2">
        <label htmlFor="report-days" className="text-sm font-medium">
          {t('period')}
        </label>
        <select
          id="report-days"
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          value={days}
          onChange={(event) => setDays(Number(event.target.value) as (typeof PERIODS)[number])}
        >
          {PERIODS.map((period) => (
            <option key={period} value={period}>
              {t('days', { days: period })}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="report-sends">
          <CardHeader>
            <CardTitle>{t('sends')}</CardTitle>
            <CardDescription>{t('sendsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity.data?.sends ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                <Tooltip />
                <Line type="monotone" dataKey="email" stroke="var(--primary)" dot={false} />
                <Line type="monotone" dataKey="inApp" stroke="#0ea5e9" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="report-growth">
          <CardHeader>
            <CardTitle>{t('growth')}</CardTitle>
            <CardDescription>{t('growthHint')}</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity.data?.contactGrowth ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                <Tooltip />
                <Line type="monotone" dataKey="contacts" stroke="#22c55e" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="report-campaigns">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>{t('campaigns')}</CardTitle>
            <CardDescription>
              {campaigns.data?.clickhouseUp === false ? t('engagementDown') : t('campaignsHint')}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                'helio-campaign-report.csv',
                ['campaign', 'sends', 'opens', 'clicks'],
                (campaigns.data?.rows ?? []).map((row) => [
                  row.campaign,
                  row.sends,
                  row.opens ?? '',
                  row.clicks ?? '',
                ]),
              )
            }
          >
            <Download className="size-4" aria-hidden /> {t('csv')}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-4 py-2 font-medium">{t('campaign')}</th>
                <th className="px-4 py-2 font-medium">{t('sendsCol')}</th>
                <th className="px-4 py-2 font-medium">{t('opens')}</th>
                <th className="px-4 py-2 font-medium">{t('clicks')}</th>
              </tr>
            </thead>
            <tbody>
              {(campaigns.data?.rows ?? []).map((row) => (
                <tr key={row.campaign} className="border-b last:border-0">
                  <td className="px-4 py-2">{row.campaign}</td>
                  <td className="px-4 py-2">{row.sends}</td>
                  <td className="text-muted-foreground px-4 py-2">{row.opens ?? '—'}</td>
                  <td className="text-muted-foreground px-4 py-2">{row.clicks ?? '—'}</td>
                </tr>
              ))}
              {(campaigns.data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted-foreground px-4 py-6 text-center">
                    {t('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="report-journeys">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>{t('journeys')}</CardTitle>
              <CardDescription>{t('journeysHint')}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  'helio-journey-report.csv',
                  ['journey', 'running', 'completed', 'failed'],
                  (journeys.data ?? []).map((row) => [
                    row.journey,
                    row.running,
                    row.completed,
                    row.failed,
                  ]),
                )
              }
            >
              <Download className="size-4" aria-hidden /> {t('csv')}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="px-4 py-2 font-medium">{t('journey')}</th>
                  <th className="px-4 py-2 font-medium">{t('running')}</th>
                  <th className="px-4 py-2 font-medium">{t('completed')}</th>
                  <th className="px-4 py-2 font-medium">{t('failed')}</th>
                </tr>
              </thead>
              <tbody>
                {(journeys.data ?? []).map((row) => (
                  <tr key={row.journey} className="border-b last:border-0">
                    <td className="px-4 py-2">{row.journey}</td>
                    <td className="px-4 py-2">{row.running}</td>
                    <td className="px-4 py-2">{row.completed}</td>
                    <td className="px-4 py-2">{row.failed}</td>
                  </tr>
                ))}
                {(journeys.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted-foreground px-4 py-6 text-center">
                      {t('empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card data-testid="report-members">
          <CardHeader>
            <CardTitle>{t('members')}</CardTitle>
            <CardDescription>{t('membersHint')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="px-4 py-2 font-medium">{t('member')}</th>
                  <th className="px-4 py-2 font-medium">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {(members.data ?? []).map((row) => (
                  <tr key={row.member} className="border-b last:border-0">
                    <td className="px-4 py-2">{row.member}</td>
                    <td className="px-4 py-2">{row.actions}</td>
                  </tr>
                ))}
                {(members.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={2} className="text-muted-foreground px-4 py-6 text-center">
                      {t('empty')}
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
