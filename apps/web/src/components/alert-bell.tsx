'use client';

import { Button } from '@helio/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { usePermission } from '@/hooks/use-permission';
import { useTRPC } from '@/trpc/client';

/**
 * The system-alert bell (G5): unread count from the SystemAlert feed that
 * send/backup/model failures raise. Admin-gated like the health page it
 * links to; polls lazily — alerts are operational, not chat.
 */
export function AlertBell() {
  const t = useTranslations('admin.bell');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { allowed } = usePermission('admin:health');
  const alerts = useQuery({
    ...trpc.admin.alertsList.queryOptions(),
    enabled: allowed,
    refetchInterval: 60_000,
  });
  const markRead = useMutation(trpc.admin.alertsMarkRead.mutationOptions());

  if (!allowed) return null;
  const unread = alerts.data?.unread ?? 0;
  const recent = (alerts.data?.alerts ?? []).slice(0, 8);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('open', { count: unread })}>
          <span className="relative">
            <Bell aria-hidden className="size-5" />
            {unread > 0 && (
              <span
                data-testid="alert-badge"
                className="bg-destructive text-destructive-foreground absolute -top-1.5 -right-2 grid size-4 place-items-center rounded-full text-[10px] leading-none font-semibold"
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t('title')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-center text-sm">{t('empty')}</p>
        )}
        {recent.map((alert) => (
          <DropdownMenuItem key={alert.id} asChild>
            <Link href="/admin/health" className="grid gap-0.5">
              <span
                className={alert.readAt ? 'text-muted-foreground text-sm' : 'text-sm font-medium'}
              >
                {alert.message}
              </span>
              <span className="text-muted-foreground text-xs">
                {new Date(alert.createdAt).toLocaleString()}
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        {unread > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await markRead.mutateAsync({});
                await queryClient.invalidateQueries(trpc.admin.alertsList.pathFilter());
              }}
            >
              {t('markAllRead')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
