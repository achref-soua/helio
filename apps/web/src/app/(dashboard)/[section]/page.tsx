import { Card, CardDescription, CardHeader, CardTitle } from '@helio/ui/components/card';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

const SECTIONS = new Set(['segments', 'journeys']);

export default async function SectionPlaceholderPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!SECTIONS.has(section)) notFound();

  const [tNav, tPlaceholder] = await Promise.all([
    getTranslations('nav'),
    getTranslations('placeholder'),
  ]);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{tNav(section)}</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{tPlaceholder('title')}</CardTitle>
          <CardDescription>{tPlaceholder('body')}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
