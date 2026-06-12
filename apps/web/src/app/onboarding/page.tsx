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
import { useMutation } from '@tanstack/react-query';
import { Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';
import { useTRPC } from '@/trpc/client';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 48);
}

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const createWorkspace = useMutation(trpc.workspace.create.mutationOptions());

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = slugify(name);
    if (!slug) return;
    setPending(true);
    try {
      const { data, error } = await authClient.organization.create({ name, slug });
      if (error || !data) {
        toast.error(error?.message ?? t('genericError'));
        return;
      }
      await authClient.organization.setActive({ organizationId: data.id });
      await createWorkspace.mutateAsync({ name: t('defaultWorkspace'), slug: 'default' });
      router.push('/');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="bg-radiant grid min-h-svh place-items-center p-6">
      <div className="grid w-full max-w-sm gap-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <Sun className="text-primary size-6" aria-hidden />
          Helio
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="org-name">{t('orgName')}</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('orgPlaceholder')}
                  required
                />
                <p className="text-muted-foreground text-xs">
                  {t('slugPreview', { slug: slugify(name) || '…' })}
                </p>
              </div>
              <Button type="submit" disabled={pending || !slugify(name)}>
                {pending ? t('working') : t('createAction')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
