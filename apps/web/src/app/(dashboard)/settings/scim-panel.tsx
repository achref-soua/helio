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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

export function ScimPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('scim');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<string | null>(null);

  const status = useQuery({ ...trpc.sso.scimStatus.queryOptions(), enabled: canManage });
  const generate = useMutation(trpc.sso.generateScimToken.mutationOptions());
  const revoke = useMutation(trpc.sso.revokeScimToken.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.sso.scimStatus.pathFilter());

  async function onGenerate() {
    try {
      const result = await generate.mutateAsync();
      setRevealed(result.token);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onRevoke() {
    try {
      await revoke.mutateAsync();
      toast.success(t('revoked'));
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const data = status.data;

  return (
    <Card data-testid="scim-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" aria-hidden />
          {t('title')}
          {data?.configured && (
            <Badge variant="secondary" data-testid="scim-configured">
              {t('active')}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        {canManage && (
          <CardAction className="flex gap-2">
            {data?.configured && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onRevoke}
                disabled={revoke.isPending}
                data-testid="scim-revoke"
              >
                {t('revoke')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={onGenerate}
              disabled={generate.isPending}
              data-testid="scim-generate"
            >
              {data?.configured ? t('regenerate') : t('generate')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="grid gap-1">
          <span className="text-muted-foreground">{t('endpoint')}</span>
          <code
            className="bg-muted rounded px-2 py-1 text-xs break-all"
            data-testid="scim-base-url"
          >
            {data?.baseUrl ?? '—'}
          </code>
        </div>
        {data?.configured && data.lastUsedAt && (
          <p className="text-muted-foreground text-xs">
            {t('lastUsed', { when: new Date(data.lastUsedAt).toLocaleString() })}
          </p>
        )}
      </CardContent>

      <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('tokenTitle')}</DialogTitle>
            <DialogDescription>{t('tokenSubtitle')}</DialogDescription>
          </DialogHeader>
          <code
            className="bg-muted rounded px-3 py-2 text-xs break-all select-all"
            data-testid="scim-token"
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
