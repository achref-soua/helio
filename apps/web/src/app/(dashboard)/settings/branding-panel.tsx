'use client';

import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palette } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

const DEFAULT_ACCENT = '#f59e0b';

export function BrandingPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('branding');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  const branding = useQuery({ ...trpc.branding.get.queryOptions(), enabled: canManage });
  const update = useMutation(trpc.branding.update.mutationOptions());

  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [logo, setLogo] = useState('');
  const [seeded, setSeeded] = useState(false);

  // Seed the form from the loaded branding exactly once — React's documented
  // "adjust state while rendering" pattern, no effect and no cascading render.
  if (branding.data && !seeded) {
    setSeeded(true);
    setName(branding.data.brandName ?? '');
    setColor(branding.data.brandColor ?? '');
    setLogo(branding.data.logo ?? '');
  }

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await update.mutateAsync({
        brandName: name.trim() || null,
        brandColor: color.trim() || null,
        logo: logo.trim() || null,
      });
      await queryClient.invalidateQueries(trpc.branding.get.pathFilter());
      toast.success(t('saved'));
      // The shell and hosted pages render branding on the server — refresh so
      // the new wordmark and accent apply immediately.
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Card data-testid="branding-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="grid max-w-md gap-4">
          <div className="grid gap-2">
            <Label htmlFor="brand-name">{t('name')}</Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={branding.data?.name ?? 'Helio'}
              maxLength={60}
              disabled={!canManage}
              data-testid="brand-name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="brand-color">{t('color')}</Label>
            <div className="flex items-center gap-3">
              <input
                id="brand-color"
                type="color"
                value={color || DEFAULT_ACCENT}
                onChange={(event) => setColor(event.target.value)}
                disabled={!canManage}
                className="h-9 w-14 cursor-pointer rounded-md border bg-transparent"
                data-testid="brand-color"
                aria-label={t('color')}
              />
              <code className="text-muted-foreground text-xs">{color || t('default')}</code>
              {color && canManage && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setColor('')}>
                  {t('reset')}
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="brand-logo">{t('logo')}</Label>
            <Input
              id="brand-logo"
              type="url"
              value={logo}
              onChange={(event) => setLogo(event.target.value)}
              placeholder="https://cdn.example.com/logo.png"
              maxLength={2000}
              disabled={!canManage}
              data-testid="brand-logo"
            />
          </div>
          {canManage && (
            <div>
              <Button type="submit" disabled={update.isPending} data-testid="brand-save">
                {update.isPending ? t('saving') : t('save')}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
