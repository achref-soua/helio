'use client';

import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LifeBuoy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

const KIND_TONE = { BUG: 'destructive', FEEDBACK: 'secondary', QUESTION: 'outline' } as const;

export function SupportPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('support');
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const tickets = useQuery({ ...trpc.support.list.queryOptions({}), enabled: canManage });
  const setStatus = useMutation(trpc.support.setStatus.mutationOptions());

  async function onResolve(id: string) {
    try {
      await setStatus.mutateAsync({ id, status: 'RESOLVED' });
      await queryClient.invalidateQueries(trpc.support.list.pathFilter());
      toast.success(t('resolved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const rows = tickets.data ?? [];

  return (
    <Card data-testid="support-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="size-4" aria-hidden />
          {t('panelTitle')}
        </CardTitle>
        <CardDescription>{t('panelSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="support-empty">
            {t('panelEmpty')}
          </p>
        ) : (
          <ul className="grid gap-2">
            {rows.map((ticket) => (
              <li
                key={ticket.id}
                className="grid gap-1 rounded-md border p-3 text-sm"
                data-testid="support-row"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={KIND_TONE[ticket.kind]}>{t(`kinds.${ticket.kind}`)}</Badge>
                  <span className="font-medium">{ticket.subject}</span>
                  <Badge
                    variant={ticket.status === 'OPEN' ? 'outline' : 'secondary'}
                    className="ml-auto"
                  >
                    {t(`statuses.${ticket.status}`)}
                  </Badge>
                  {canManage && ticket.status === 'OPEN' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('resolveLabel', { subject: ticket.subject })}
                      onClick={() => onResolve(ticket.id)}
                      data-testid="support-resolve"
                    >
                      <Check className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground whitespace-pre-wrap">{ticket.body}</p>
                {ticket.url && <code className="text-muted-foreground text-xs">{ticket.url}</code>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
