'use client';

import { Button } from '@helio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@helio/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { usePermission } from '@/hooks/use-permission';
import { useTRPC } from '@/trpc/client';

const DISMISS_KEY = 'helio.checklist.dismissed';

/**
 * The getting-started checklist (K2): real state, not a tour — each item
 * checks itself off from the database and links to where the work
 * happens. Admin-only (the items are admin work), gone once complete or
 * dismissed.
 */
export function OnboardingChecklist() {
  const t = useTranslations('checklist');
  const trpc = useTRPC();
  const workspaceId = useActiveWorkspaceId();
  const { allowed } = usePermission('settings:credentials');
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Next frame: hydration paints first, and the compiler lint stays
    // happy about no synchronous setState inside the effect.
    const raf = requestAnimationFrame(() =>
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1'),
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  const credentials = useQuery({
    ...trpc.credentials.list.queryOptions(),
    enabled: allowed && !dismissed,
  });
  const contacts = useQuery({
    ...trpc.contact.list.queryOptions({ workspaceId: workspaceId ?? '', limit: 1 }),
    enabled: allowed && !dismissed && Boolean(workspaceId),
  });
  const members = useQuery({
    ...trpc.crm.members.queryOptions(),
    enabled: allowed && !dismissed,
  });
  const campaigns = useQuery({
    ...trpc.campaign.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: allowed && !dismissed && Boolean(workspaceId),
  });
  const journeys = useQuery({
    ...trpc.journey.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: allowed && !dismissed && Boolean(workspaceId),
  });

  if (!allowed || dismissed) return null;
  const loaded = credentials.data && contacts.data && members.data;
  if (!loaded) return null;

  const items = [
    {
      key: 'email',
      done: (credentials.data?.credentials ?? []).some((credential) =>
        credential.kind.startsWith('EMAIL_'),
      ),
      href: '/settings',
    },
    { key: 'contacts', done: (contacts.data?.total ?? 0) > 0, href: '/contacts' },
    { key: 'team', done: (members.data?.length ?? 0) > 1, href: '/settings' },
    {
      key: 'launch',
      done: (campaigns.data?.length ?? 0) > 0 || (journeys.data?.length ?? 0) > 0,
      href: '/campaigns',
    },
  ];
  if (items.every((item) => item.done)) return null;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <Card data-testid="onboarding-checklist">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <Button variant="ghost" size="icon" aria-label={t('dismiss')} onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            data-testid={`checklist-${item.key}`}
            className="hover:bg-muted/50 flex items-center gap-2 rounded-md border p-2 text-sm"
          >
            {item.done ? (
              <CheckCircle2 className="size-4 text-green-600" aria-hidden />
            ) : (
              <Circle className="text-muted-foreground size-4" aria-hidden />
            )}
            <span className={item.done ? 'text-muted-foreground line-through' : ''}>
              {t(item.key)}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
