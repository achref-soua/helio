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
import { getTranslations } from 'next-intl/server';

import { authDb } from '@/lib/auth';

import { submitForm } from './actions';

/**
 * Public hosted form. No auth: the form id is the capability, and a
 * submission can only ever create/update a contact inside the form's
 * own workspace.
 */
export default async function HostedFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { formId } = await params;
  const { ok } = await searchParams;
  const t = await getTranslations('hostedForm');
  const form = await authDb.form.findUnique({
    where: { id: formId },
    select: { id: true, title: true },
  });

  return (
    <main className="bg-muted/30 grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-md">
        {!form ? (
          <CardHeader>
            <CardTitle>{t('notFoundTitle')}</CardTitle>
            <CardDescription>{t('notFoundBody')}</CardDescription>
          </CardHeader>
        ) : ok ? (
          <CardHeader>
            <CardTitle>{t('thanksTitle')}</CardTitle>
            <CardDescription>{t('thanksBody')}</CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              {/* Real heading: public pages get crawled and screen-read. */}
              <CardTitle>
                <h1 className="text-lg leading-none font-semibold">{form.title}</h1>
              </CardTitle>
              <CardDescription>{t('subtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={submitForm} className="grid gap-4">
                <input type="hidden" name="formId" value={form.id} />
                <div className="grid gap-2">
                  <Label htmlFor="form-email">{t('email')}</Label>
                  <Input id="form-email" name="email" type="email" required maxLength={320} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="form-first-name">{t('firstName')}</Label>
                  <Input id="form-first-name" name="firstName" maxLength={80} />
                </div>
                <Button type="submit">{t('submit')}</Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
