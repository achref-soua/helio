'use client';

import { Button } from '@helio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

export function ScoringDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('contacts.scoring');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [event, setEvent] = useState('');
  const [points, setPoints] = useState('10');

  const rulesQuery = useQuery({
    ...trpc.scoring.list.queryOptions({ workspaceId }),
    enabled: open,
  });
  const createRule = useMutation(trpc.scoring.create.mutationOptions());
  const deleteRule = useMutation(trpc.scoring.delete.mutationOptions());
  const invalidate = () => queryClient.invalidateQueries(trpc.scoring.list.pathFilter());

  async function onAdd(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    try {
      await createRule.mutateAsync({
        workspaceId,
        event: event.trim(),
        points: Number(points),
      });
      await invalidate();
      toast.success(t('created'));
      setEvent('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong');
    }
  }

  async function onDelete(id: string) {
    await deleteRule.mutateAsync({ id });
    await invalidate();
    toast.success(t('deleted'));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onAdd} className="flex items-end gap-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="scoring-event">{t('event')}</Label>
            <Input
              id="scoring-event"
              value={event}
              onChange={(changeEvent) => setEvent(changeEvent.target.value)}
              placeholder="e.g. Demo Booked"
              required
              maxLength={200}
            />
          </div>
          <div className="grid w-24 gap-2">
            <Label htmlFor="scoring-points">{t('points')}</Label>
            <Input
              id="scoring-points"
              type="number"
              min={-1000}
              max={1000}
              value={points}
              onChange={(changeEvent) => setPoints(changeEvent.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={createRule.isPending}>
            {t('addAction')}
          </Button>
        </form>

        <ul className="grid gap-1" data-testid="scoring-rules">
          {rulesQuery.data?.length === 0 && (
            <li className="text-muted-foreground text-sm">{t('empty')}</li>
          )}
          {rulesQuery.data?.map((rule) => (
            <li key={rule.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{rule.event}</span>
              <span className="text-muted-foreground tabular-nums">
                {rule.points > 0 ? `+${rule.points}` : rule.points}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label={t('deleteAction', { event: rule.event })}
                onClick={() => onDelete(rule.id)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
