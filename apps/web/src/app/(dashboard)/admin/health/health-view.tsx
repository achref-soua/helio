'use client';

import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

/**
 * System health (G5): every service and store at a glance, the backup
 * pulse, configuration trouble spots, and the alert feed with mark-read.
 * Built to render fast when half the stack is down — that is when an
 * operator opens it.
 */

function StatusBadge({ up, optional }: { up: boolean; optional: boolean }) {
  const t = useTranslations('admin.health');
  if (up) return <Badge variant="secondary">{t('up')}</Badge>;
  return (
    <Badge variant={optional ? 'outline' : 'destructive'}>{optional ? t('off') : t('down')}</Badge>
  );
}

export function HealthView() {
  const t = useTranslations('admin.health');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const health = useQuery({ ...trpc.admin.health.queryOptions(), refetchInterval: 30_000 });
  const alerts = useQuery(trpc.admin.alertsList.queryOptions());
  const markRead = useMutation(trpc.admin.alertsMarkRead.mutationOptions());

  async function onMarkRead(id?: string) {
    try {
      await markRead.mutateAsync({ id });
      await queryClient.invalidateQueries(trpc.admin.alertsList.pathFilter());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'failed');
    }
  }

  const data = health.data;
  return (
    <div className="grid grid-cols-1 gap-4" data-testid="health-view">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="health-services">
          <CardHeader>
            <CardTitle>{t('services')}</CardTitle>
            <CardDescription>{t('servicesHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(data?.services ?? []).map((service) => (
              <div key={service.name} className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{service.name}</span>
                <span className="flex items-center gap-2">
                  {service.version && (
                    <span className="text-muted-foreground text-xs">v{service.version}</span>
                  )}
                  <StatusBadge up={service.up} optional={service.optional} />
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="health-stores">
          <CardHeader>
            <CardTitle>{t('stores')}</CardTitle>
            <CardDescription>{t('storesHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(data?.stores ?? []).map((store) => (
              <div key={store.name} className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{store.name}</span>
                <StatusBadge up={store.up} optional={store.optional} />
              </div>
            ))}
            <div className="mt-2 grid gap-1 border-t pt-3 text-sm">
              <div className="flex items-center justify-between">
                <span>{t('lastBackup')}</span>
                <span className={data?.backup.stale ? 'text-destructive' : 'text-muted-foreground'}>
                  {data?.backup.lastOkAgeHours === null || data?.backup.lastOkAgeHours === undefined
                    ? t('never')
                    : t('hoursAgo', { hours: data.backup.lastOkAgeHours })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('failedCredentials')}</span>
                <span
                  className={data?.failedCredentials ? 'text-destructive' : 'text-muted-foreground'}
                >
                  {data?.failedCredentials ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('failedModels')}</span>
                <span className={data?.failedModels ? 'text-destructive' : 'text-muted-foreground'}>
                  {data?.failedModels ?? 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="health-alerts">
        <CardHeader>
          <CardTitle>{t('alerts')}</CardTitle>
          <CardDescription>{t('alertsHint')}</CardDescription>
          {(alerts.data?.unread ?? 0) > 0 && (
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => onMarkRead()}>
                {t('markAllRead')}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-4 py-2 font-medium">{t('when')}</th>
                <th className="px-4 py-2 font-medium">{t('kind')}</th>
                <th className="px-4 py-2 font-medium">{t('message')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(alerts.data?.alerts ?? []).map((alert) => (
                <tr
                  key={alert.id}
                  data-testid="alert-row"
                  className={`border-b last:border-0 ${alert.readAt ? 'text-muted-foreground' : ''}`}
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(alert.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <code className="text-xs">{alert.kind}</code>
                  </td>
                  <td className="px-4 py-2">{alert.message}</td>
                  <td className="px-4 py-2 text-right">
                    {!alert.readAt && (
                      <Button variant="ghost" size="sm" onClick={() => onMarkRead(alert.id)}>
                        {t('markRead')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {(alerts.data?.alerts ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted-foreground px-4 py-8 text-center">
                    {t('noAlerts')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
