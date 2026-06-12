'use client';

import { WEBHOOK_EVENTS, type WebhookEvent } from '@helio/core';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helio/ui/components/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, Webhook } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

export function WebhooksPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('webhooks');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<WebhookEvent>>(new Set());

  const endpoints = useQuery({ ...trpc.webhook.list.queryOptions(), enabled: canManage });
  const create = useMutation(trpc.webhook.create.mutationOptions());
  const update = useMutation(trpc.webhook.update.mutationOptions());
  const remove = useMutation(trpc.webhook.remove.mutationOptions());
  const sendTest = useMutation(trpc.webhook.sendTest.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.webhook.list.pathFilter());

  function toggleEvent(event: WebhookEvent) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const url = String(form.get('url') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    if (selected.size === 0) {
      toast.error(t('pickEvent'));
      return;
    }
    try {
      const { secret } = await create.mutateAsync({
        url,
        description: description || undefined,
        events: [...selected],
      });
      setRevealed(secret);
      setOpen(false);
      setSelected(new Set());
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onToggleEnabled(id: string, enabled: boolean) {
    try {
      await update.mutateAsync({ id, enabled: !enabled });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onSendTest(id: string) {
    try {
      const result = await sendTest.mutateAsync({ id });
      if (result.ok) toast.success(t('testOk', { status: result.status }));
      else toast.error(t('testFailed', { detail: result.error ?? String(result.status) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onRemove(id: string) {
    try {
      await remove.mutateAsync({ id });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const rows = endpoints.data ?? [];

  return (
    <Card data-testid="webhooks-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        {canManage && (
          <CardAction>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="webhook-create">
                  {t('createAction')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('createTitle')}</DialogTitle>
                  <DialogDescription>{t('createSubtitle')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onCreate} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="webhook-url">{t('url')}</Label>
                    <Input
                      id="webhook-url"
                      name="url"
                      type="url"
                      placeholder="https://example.com/webhooks/helio"
                      required
                      data-testid="webhook-url"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="webhook-description">{t('description')}</Label>
                    <Input id="webhook-description" name="description" maxLength={200} />
                  </div>
                  <fieldset className="grid gap-2">
                    <legend className="text-sm font-medium">{t('events')}</legend>
                    {WEBHOOK_EVENTS.map((event) => (
                      <label key={event} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={selected.has(event)}
                          onChange={() => toggleEvent(event)}
                          data-testid={`webhook-event-${event}`}
                        />
                        <code className="text-xs">{event}</code>
                      </label>
                    ))}
                  </fieldset>
                  <DialogFooter>
                    <Button type="submit" disabled={create.isPending} data-testid="webhook-submit">
                      {create.isPending ? t('working') : t('createSubmit')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="webhooks-empty">
            {t('empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.endpoint')}</TableHead>
                <TableHead>{t('columns.events')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                {canManage && (
                  <TableHead className="sr-only w-10">{t('columns.actions')}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((endpoint) => (
                <TableRow key={endpoint.id} data-testid="webhook-row">
                  <TableCell className="max-w-[16rem]">
                    <code className="text-xs break-all">{endpoint.url}</code>
                    {endpoint.description && (
                      <p className="text-muted-foreground text-xs">{endpoint.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {endpoint.events.map((event) => (
                        <Badge key={event} variant="outline" className="text-[10px]">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => onToggleEnabled(endpoint.id, endpoint.enabled)}
                        data-testid="webhook-toggle"
                      >
                        <Badge variant={endpoint.enabled ? 'secondary' : 'outline'}>
                          {endpoint.enabled ? t('enabled') : t('disabled')}
                        </Badge>
                      </Button>
                    ) : (
                      <Badge variant={endpoint.enabled ? 'secondary' : 'outline'}>
                        {endpoint.enabled ? t('enabled') : t('disabled')}
                      </Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onSendTest(endpoint.id)}
                        disabled={sendTest.isPending}
                        aria-label={t('testLabel', { url: endpoint.url })}
                        data-testid="webhook-test"
                      >
                        <Send className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(endpoint.id)}
                        aria-label={t('removeLabel', { url: endpoint.url })}
                        data-testid="webhook-remove"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={revealed !== null} onOpenChange={(next) => !next && setRevealed(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('secretTitle')}</DialogTitle>
            <DialogDescription>{t('secretSubtitle')}</DialogDescription>
          </DialogHeader>
          <code
            className="bg-muted rounded px-3 py-2 text-xs break-all select-all"
            data-testid="webhook-secret"
          >
            {revealed}
          </code>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (revealed) {
                  void navigator.clipboard?.writeText(revealed);
                  toast.success(t('copied'));
                }
              }}
            >
              {t('copy')}
            </Button>
            <Button onClick={() => setRevealed(null)}>{t('done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
