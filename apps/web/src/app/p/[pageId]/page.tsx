import { type LandingBlock } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import { Input } from '@helio/ui/components/input';
import { getTranslations } from 'next-intl/server';

import { BrandStyle } from '@/components/brand-style';
import { PoweredBy } from '@/components/powered-by';
import { authDb } from '@/lib/auth';

import { submitLandingForm } from './actions';

/** Public, server-rendered landing page. No auth: the page id is the capability. */
export default async function PublicLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { pageId } = await params;
  const { ok } = await searchParams;
  const t = await getTranslations('hostedLanding');

  const page = await authDb.landingPage.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      blocks: true,
      published: true,
      workspace: {
        select: {
          organization: {
            select: { name: true, brandName: true, brandColor: true, logo: true },
          },
        },
      },
    },
  });
  const brand = page?.workspace.organization;

  if (!page || !page.published) {
    return (
      <main className="bg-muted/30 grid min-h-svh place-items-center p-6">
        <p className="text-muted-foreground text-sm">{t('notFound')}</p>
      </main>
    );
  }

  const blocks = (page.blocks as unknown as LandingBlock[]) ?? [];
  const firstHeading = blocks.findIndex((block) => block.type === 'heading');

  return (
    <main className="flex min-h-svh flex-col">
      <BrandStyle color={brand?.brandColor} />
      {/* A soft brand-tinted wash so even a two-block page reads designed. */}
      <div className="from-primary/10 flex flex-1 items-center justify-center bg-linear-to-b to-transparent to-50% px-6 py-16">
        <article className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
          {brand && (brand.brandName || brand.logo) && (
            <div className="flex items-center gap-2 font-semibold">
              {brand.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt="" className="size-6 rounded object-contain" />
              )}
              <span>{brand.brandName ?? brand.name}</span>
            </div>
          )}
          {ok && (
            <p
              className="bg-primary/10 text-primary rounded-md px-3 py-2 text-sm"
              data-testid="landing-thanks"
            >
              {t('thanks')}
            </p>
          )}
          {blocks.map((block, index) => {
            switch (block.type) {
              case 'heading':
                return index === firstHeading ? (
                  <h1
                    key={index}
                    className="text-4xl font-bold tracking-tight text-balance sm:text-5xl"
                  >
                    {block.text}
                  </h1>
                ) : (
                  <h2 key={index} className="text-2xl font-semibold tracking-tight text-balance">
                    {block.text}
                  </h2>
                );
              case 'text':
                return (
                  <p
                    key={index}
                    className="text-muted-foreground max-w-prose text-lg whitespace-pre-wrap"
                  >
                    {block.text}
                  </p>
                );
              case 'image':
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={index}
                    src={block.url}
                    alt={block.alt}
                    className="w-full rounded-xl border shadow-sm"
                  />
                );
              case 'button':
                return (
                  <a
                    key={index}
                    href={block.href}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex w-fit items-center rounded-lg px-6 py-3 text-sm font-medium shadow-sm transition-colors"
                  >
                    {block.label}
                  </a>
                );
              case 'form':
                return (
                  <form
                    key={index}
                    action={submitLandingForm}
                    className="flex w-full max-w-md flex-wrap justify-center gap-2"
                    data-testid="landing-form"
                  >
                    <input type="hidden" name="pageId" value={page.id} />
                    <Input
                      name="email"
                      type="email"
                      required
                      placeholder={t('emailPlaceholder')}
                      className="bg-background min-w-48 flex-1"
                    />
                    <Button type="submit" size="lg">
                      {block.buttonLabel}
                    </Button>
                  </form>
                );
            }
          })}
        </article>
      </div>
      <PoweredBy whiteLabeled={Boolean(brand && (brand.brandName || brand.logo))} />
    </main>
  );
}
