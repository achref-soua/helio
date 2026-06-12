'use client';

import { SHOPIFY_TOPICS } from '@helio/core';
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
import { Plug, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

export function IntegrationsPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('integrations');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [open, setOpen] = useState(false);
  const [sfOpen, setSfOpen] = useState(false);

  const list = useQuery({ ...trpc.integrations.list.queryOptions(), enabled: canManage });
  const connect = useMutation(trpc.integrations.connectShopify.mutationOptions());
  const connectSf = useMutation(trpc.integrations.connectSalesforce.mutationOptions());
  const setEnabled = useMutation(trpc.integrations.setEnabled.mutationOptions());
  const disconnect = useMutation(trpc.integrations.disconnect.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.integrations.list.pathFilter());

  async function onConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = new FormData(event.currentTarget);
    try {
      await connect.mutateAsync({
        workspaceId,
        shopDomain: String(form.get('shop') ?? '').trim(),
        secret: String(form.get('secret') ?? '').trim(),
      });
      await invalidate();
      toast.success(t('connected'));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onConnectSalesforce(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = new FormData(event.currentTarget);
    try {
      await connectSf.mutateAsync({
        workspaceId,
        instanceUrl: String(form.get('instanceUrl') ?? '').trim(),
        accessToken: String(form.get('accessToken') ?? '').trim(),
      });
      await invalidate();
      toast.success(t('connected'));
      setSfOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onToggle(id: string, enabled: boolean) {
    try {
      await setEnabled.mutateAsync({ id, enabled: !enabled });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onDisconnect(id: string) {
    try {
      await disconnect.mutateAsync({ id });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const rows = list.data ?? [];

  return (
    <Card data-testid="integrations-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        {canManage && (
          <CardAction className="flex flex-wrap gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="integration-connect">
                  {t('connectShopify')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('connectTitle')}</DialogTitle>
                  <DialogDescription>{t('connectSubtitle')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onConnect} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="shop">{t('shopDomain')}</Label>
                    <Input
                      id="shop"
                      name="shop"
                      placeholder="acme.myshopify.com"
                      required
                      data-testid="integration-shop"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="secret">{t('secret')}</Label>
                    <Input
                      id="secret"
                      name="secret"
                      type="password"
                      required
                      data-testid="integration-secret"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={connect.isPending}
                      data-testid="integration-save"
                    >
                      {connect.isPending ? t('connecting') : t('connect')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={sfOpen} onOpenChange={setSfOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="integration-connect-sf">
                  {t('connectSalesforce')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('connectSfTitle')}</DialogTitle>
                  <DialogDescription>{t('connectSfSubtitle')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onConnectSalesforce} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="instanceUrl">{t('instanceUrl')}</Label>
                    <Input
                      id="instanceUrl"
                      name="instanceUrl"
                      placeholder="https://acme.my.salesforce.com"
                      required
                      data-testid="integration-instance"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="accessToken">{t('accessToken')}</Label>
                    <Input
                      id="accessToken"
                      name="accessToken"
                      type="password"
                      required
                      data-testid="integration-token"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={connectSf.isPending}
                      data-testid="integration-save-sf"
                    >
                      {connectSf.isPending ? t('connecting') : t('connect')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="integrations-empty">
            {t('empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.provider')}</TableHead>
                <TableHead>{t('columns.account')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                {canManage && (
                  <TableHead className="sr-only w-10">{t('columns.actions')}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((integration) => (
                <TableRow key={integration.id} data-testid="integration-row">
                  <TableCell className="font-medium capitalize">
                    {integration.provider.toLowerCase()}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{integration.externalId ?? '—'}</code>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => onToggle(integration.id, integration.enabled)}
                        data-testid="integration-toggle"
                      >
                        <Badge variant={integration.enabled ? 'secondary' : 'outline'}>
                          {integration.enabled ? t('enabled') : t('disabled')}
                        </Badge>
                      </Button>
                    ) : (
                      <Badge variant={integration.enabled ? 'secondary' : 'outline'}>
                        {integration.enabled ? t('enabled') : t('disabled')}
                      </Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDisconnect(integration.id)}
                        aria-label={t('disconnectLabel', { account: integration.externalId ?? '' })}
                        data-testid="integration-disconnect"
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
        <p className="text-muted-foreground text-xs">
          {t('webhookHint')} <code>POST /webhooks/shopify</code> — {t('topics')}{' '}
          {SHOPIFY_TOPICS.map((topic) => (
            <code key={topic} className="mr-1">
              {topic}
            </code>
          ))}
        </p>
      </CardContent>
    </Card>
  );
}
