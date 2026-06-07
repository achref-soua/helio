'use client';

import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Sun } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { authClient, useSession } from '@/lib/auth-client';

export default function AcceptInvitationPage() {
  const t = useTranslations('invite');
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { data: session, isPending } = useSession();
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId: id });
    setPending(false);
    if (error || !data) {
      toast.error(error?.message ?? t('genericError'));
      return;
    }
    await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
    router.push('/');
    router.refresh();
  }

  return (
    <main className="grid min-h-svh place-items-center p-6">
      <div className="grid w-full max-w-sm gap-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <Sun className="text-primary size-6" aria-hidden />
          Helio
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>
              {session ? t('bodyAuthed', { email: session.user.email }) : t('bodyAnonymous')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {session ? (
              <Button onClick={accept} disabled={pending || isPending}>
                {pending ? t('working') : t('acceptAction')}
              </Button>
            ) : (
              <>
                <Button asChild>
                  <Link href="/signup">{t('signupFirst')}</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/login">{t('loginFirst')}</Link>
                </Button>
                <p className="text-muted-foreground text-center text-xs">{t('returnHint')}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
