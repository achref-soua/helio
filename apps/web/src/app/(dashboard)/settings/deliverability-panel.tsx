'use client';

import { deliverabilityRecords, suggestedSpfInclude } from '@helio/core';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

export function DeliverabilityPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('deliverability');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [open, setOpen] = useState(false);

  const domains = useQuery({
    ...trpc.deliverability.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: canManage && !!workspaceId,
  });
  // Suggest the SPF include from the org's connected email provider.
  const credentials = useQuery({ ...trpc.credentials.list.queryOptions(), enabled: canManage });
  const emailCredential = credentials.data?.credentials.find((credential) =>
    credential.kind.startsWith('EMAIL_'),
  );
  const spfSuggestion = emailCredential ? suggestedSpfInclude(emailCredential.kind) : null;
  const add = useMutation(trpc.deliverability.add.mutationOptions());
  const verify = useMutation(trpc.deliverability.verify.mutationOptions());
  const remove = useMutation(trpc.deliverability.remove.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.deliverability.list.pathFilter());

  async function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = new FormData(event.currentTarget);
    try {
      await add.mutateAsync({
        workspaceId,
        domain: String(form.get('domain') ?? '').trim(),
        spfInclude: String(form.get('spfInclude') ?? '').trim() || undefined,
      });
      await invalidate();
      toast.success(t('added'));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onVerify(id: string) {
    try {
      const result = await verify.mutateAsync({ id });
      await invalidate();
      if (result.verified) toast.success(t('verified'));
      else {
        const missing = Object.entries(result.checks)
          .filter(([, ok]) => !ok)
          .map(([name]) => name)
          .join(', ');
        toast.error(t('notVerified', { missing }));
      }
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

  const rows = domains.data ?? [];

  return (
    <Card data-testid="deliverability-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailCheck className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        {canManage && (
          <CardAction>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="domain-add">
                  {t('addAction')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('addTitle')}</DialogTitle>
                  <DialogDescription>{t('addSubtitle')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onAdd} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="domain">{t('domain')}</Label>
                    <Input
                      id="domain"
                      name="domain"
                      placeholder="mail.acme.com"
                      required
                      data-testid="domain-name"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="spfInclude">{t('spfInclude')}</Label>
                    <Input
                      id="spfInclude"
                      name="spfInclude"
                      defaultValue={spfSuggestion ?? ''}
                      placeholder="amazonses.com"
                    />
                    {spfSuggestion && emailCredential ? (
                      <p className="text-muted-foreground text-xs">
                        {t('spfSuggested', { name: emailCredential.name })}
                      </p>
                    ) : null}
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={add.isPending} data-testid="domain-submit">
                      {add.isPending ? t('adding') : t('add')}
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
          <p className="text-muted-foreground text-sm" data-testid="deliverability-empty">
            {t('empty')}
          </p>
        ) : (
          <ul className="grid gap-3">
            {rows.map((domain) => {
              const records = deliverabilityRecords({
                domain: domain.domain,
                dkimSelector: domain.dkimSelector,
                dkimPublicKey: domain.dkimPublicKey,
                spfInclude: domain.spfInclude,
              });
              return (
                <li
                  key={domain.id}
                  className="grid gap-2 rounded-md border p-3"
                  data-testid="domain-row"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{domain.domain}</span>
                    <Badge variant={domain.status === 'VERIFIED' ? 'secondary' : 'outline'}>
                      {t(`status.${domain.status}`)}
                    </Badge>
                    {canManage && (
                      <div className="ml-auto flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => onVerify(domain.id)}
                          disabled={verify.isPending}
                          data-testid="domain-verify"
                        >
                          {t('verify')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t('removeLabel', { domain: domain.domain })}
                          onClick={() => onRemove(domain.id)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    {records.map((record) => (
                      <div key={record.label} className="grid gap-0.5 text-xs">
                        <span className="text-muted-foreground font-medium">
                          {record.label} · TXT · {record.host}
                        </span>
                        <code className="bg-muted rounded px-2 py-1 break-all select-all">
                          {record.value}
                        </code>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
