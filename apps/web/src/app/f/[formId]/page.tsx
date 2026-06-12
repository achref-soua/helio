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
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BrandStyle } from '@/components/brand-style';
import { PoweredBy } from '@/components/powered-by';
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
    select: {
      id: true,
      title: true,
      // White-label the public page with the owning org's branding.
      workspace: {
        select: {
          organization: {
            select: { name: true, brandName: true, brandColor: true, logo: true },
          },
        },
      },
    },
  });
  // A real 404, not a 200 with sad text — crawlers and uptime checks care.
  if (!form) notFound();
  const brand = form.workspace.organization;

  return (
    <main className="bg-muted/30 flex min-h-svh flex-col p-6">
      <BrandStyle color={brand?.brandColor} />
      <div className="m-auto grid w-full max-w-md gap-4">
        {brand && (brand.brandName || brand.logo) && (
          <div className="flex items-center justify-center gap-2 font-semibold">
            {brand.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} alt="" className="size-6 rounded object-contain" />
            )}
            <span>{brand.brandName ?? brand.name}</span>
          </div>
        )}
        <Card className="w-full">
          {ok ? (
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
      </div>
      <PoweredBy whiteLabeled={Boolean(brand && (brand.brandName || brand.logo))} />
    </main>
  );
}
