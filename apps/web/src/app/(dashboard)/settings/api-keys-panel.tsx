'use client';

import { API_SCOPES } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import {
  Card,
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
import { KeySquare, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

export function ApiKeysPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('apiKeys');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [scopePicks, setScopePicks] = useState<Record<string, boolean>>({});

  const keys = useQuery({ ...trpc.apiKey.list.queryOptions(), enabled: canManage });
  const create = useMutation(trpc.apiKey.create.mutationOptions());
  const revoke = useMutation(trpc.apiKey.revoke.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.apiKey.list.pathFilter());

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    const selected = API_SCOPES.filter((scope) => scopePicks[scope]);
    try {
      const { key } = await create.mutateAsync({
        name,
        // No selection = full grant (the default for server-to-server keys).
        scopes: selected.length > 0 ? selected : undefined,
      });
      setRevealed(key);
      setOpen(false);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onRevoke(id: string) {
    try {
      await revoke.mutateAsync({ id });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const rows = keys.data ?? [];

  return (
    <Card data-testid="api-keys-panel">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <KeySquare className="size-4" aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="api-key-create">
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
                  <Label htmlFor="api-key-name">{t('name')}</Label>
                  <Input
                    id="api-key-name"
                    name="name"
                    placeholder="Production server"
                    required
                    data-testid="api-key-name"
                  />
                </div>
                <div className="grid gap-2">
                  <span className="text-sm font-medium">{t('scopesLabel')}</span>
                  <p className="text-muted-foreground text-xs">{t('scopesHint')}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {API_SCOPES.map((scope) => (
                      <label key={scope} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="accent-primary size-4"
                          checked={scopePicks[scope] ?? false}
                          onChange={() =>
                            setScopePicks((current) => ({ ...current, [scope]: !current[scope] }))
                          }
                        />
                        <code className="text-xs">{scope}</code>
                      </label>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending} data-testid="api-key-submit">
                    {create.isPending ? t('working') : t('createSubmit')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="api-keys-empty">
            {t('empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.key')}</TableHead>
                <TableHead>{t('columns.scopes')}</TableHead>
                <TableHead>{t('columns.lastUsed')}</TableHead>
                {canManage && (
                  <TableHead className="sr-only w-10">{t('columns.actions')}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((key) => (
                <TableRow key={key.id} data-testid="api-key-row">
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <code className="text-muted-foreground text-xs">{key.prefix}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {key.scopes.includes('*') ? t('fullAccess') : key.scopes.join(', ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : t('never')}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRevoke(key.id)}
                        aria-label={t('revokeLabel', { name: key.name })}
                        data-testid="api-key-revoke"
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
            data-testid="api-key-secret"
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
