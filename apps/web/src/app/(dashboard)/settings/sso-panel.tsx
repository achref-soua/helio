'use client';

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
import { KeyRound, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

export function SsoPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('sso');
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);

  const providers = useQuery({ ...trpc.sso.list.queryOptions(), enabled: canManage });
  const register = useMutation(trpc.sso.register.mutationOptions());
  const remove = useMutation(trpc.sso.remove.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.sso.list.pathFilter());

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const str = (key: string) => String(form.get(key) ?? '').trim();
    try {
      await register.mutateAsync({
        providerId: str('providerId'),
        domain: str('domain'),
        issuer: str('issuer'),
        clientId: str('clientId'),
        clientSecret: str('clientSecret'),
        ...(manual
          ? {
              authorizationEndpoint: str('authorizationEndpoint'),
              tokenEndpoint: str('tokenEndpoint'),
              jwksEndpoint: str('jwksEndpoint'),
            }
          : {}),
      });
      toast.success(t('added'));
      setOpen(false);
      setManual(false);
      await invalidate();
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

  const rows = providers.data ?? [];

  return (
    <Card data-testid="sso-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        {canManage && (
          <CardAction>
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                if (!next) setManual(false);
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" data-testid="sso-add">
                  {t('addAction')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t('addTitle')}</DialogTitle>
                  <DialogDescription>{t('addSubtitle')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmit} className="grid gap-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="sso-domain">{t('fields.domain')}</Label>
                      <Input
                        id="sso-domain"
                        name="domain"
                        placeholder="acme.com"
                        required
                        data-testid="sso-domain"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="sso-provider-id">{t('fields.providerId')}</Label>
                      <Input
                        id="sso-provider-id"
                        name="providerId"
                        placeholder="acme-okta"
                        required
                        data-testid="sso-provider-id"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="sso-issuer">{t('fields.issuer')}</Label>
                    <Input
                      id="sso-issuer"
                      name="issuer"
                      type="url"
                      placeholder="https://acme.okta.com"
                      required
                      data-testid="sso-issuer"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="sso-client-id">{t('fields.clientId')}</Label>
                      <Input
                        id="sso-client-id"
                        name="clientId"
                        required
                        data-testid="sso-client-id"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="sso-client-secret">{t('fields.clientSecret')}</Label>
                      <Input
                        id="sso-client-secret"
                        name="clientSecret"
                        type="password"
                        required
                        data-testid="sso-client-secret"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={manual}
                      onChange={(event) => setManual(event.target.checked)}
                      data-testid="sso-manual-toggle"
                    />
                    {t('fields.manual')}
                  </label>

                  {manual && (
                    <div className="grid gap-4 border-l-2 pl-4">
                      <div className="grid gap-2">
                        <Label htmlFor="sso-authorization-endpoint">
                          {t('fields.authorizationEndpoint')}
                        </Label>
                        <Input
                          id="sso-authorization-endpoint"
                          name="authorizationEndpoint"
                          type="url"
                          required
                          data-testid="sso-authorization-endpoint"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sso-token-endpoint">{t('fields.tokenEndpoint')}</Label>
                        <Input
                          id="sso-token-endpoint"
                          name="tokenEndpoint"
                          type="url"
                          required
                          data-testid="sso-token-endpoint"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sso-jwks-endpoint">{t('fields.jwksEndpoint')}</Label>
                        <Input
                          id="sso-jwks-endpoint"
                          name="jwksEndpoint"
                          type="url"
                          required
                          data-testid="sso-jwks-endpoint"
                        />
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    <Button type="submit" disabled={register.isPending} data-testid="sso-submit">
                      {register.isPending ? t('working') : t('addSubmit')}
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
          <p className="text-muted-foreground text-sm" data-testid="sso-empty">
            {t('empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.domain')}</TableHead>
                <TableHead>{t('columns.issuer')}</TableHead>
                <TableHead>{t('columns.callback')}</TableHead>
                {canManage && (
                  <TableHead className="w-10 text-right sr-only">{t('columns.actions')}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((provider) => (
                <TableRow key={provider.id} data-testid="sso-provider-row">
                  <TableCell className="font-medium">{provider.domain}</TableCell>
                  <TableCell className="text-muted-foreground">{provider.issuer}</TableCell>
                  <TableCell>
                    <code className="text-muted-foreground text-xs break-all">
                      {provider.callbackUrl}
                    </code>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(provider.id)}
                        aria-label={t('removeLabel', { domain: provider.domain })}
                        data-testid="sso-remove"
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
    </Card>
  );
}
