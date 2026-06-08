import { verifyUnsubscribeToken } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { getTranslations } from 'next-intl/server';

import { authDb } from '@/lib/auth';
import { env } from '@/lib/env';

import { unsubscribeContact } from './actions';

/**
 * Public preference page. The signed token both identifies the contact
 * and authorizes the change — no session involved. GET never mutates;
 * the unsubscribe itself is the form POST (or the RFC 8058 one-click
 * POST handled in route.ts).
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('unsubscribe');
  const contactId = await verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, decodeURIComponent(token));
  const contact = contactId
    ? await authDb.contact.findUnique({
        where: { id: contactId },
        select: { email: true, status: true },
      })
    : null;

  return (
    <main className="bg-muted/30 grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-md">
        {!contact ? (
          <CardHeader>
            <CardTitle>{t('invalidTitle')}</CardTitle>
            <CardDescription>{t('invalidBody')}</CardDescription>
          </CardHeader>
        ) : contact.status === 'UNSUBSCRIBED' ? (
          <CardHeader>
            <CardTitle>{t('doneTitle')}</CardTitle>
            <CardDescription>{t('doneBody', { email: contact.email })}</CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{t('title')}</CardTitle>
              <CardDescription>{t('body', { email: contact.email })}</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={unsubscribeContact}>
                <input type="hidden" name="token" value={token} />
                <Button type="submit" variant="destructive">
                  {t('confirm')}
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
