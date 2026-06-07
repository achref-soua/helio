import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { getTranslations } from 'next-intl/server';

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  const cards = ['contacts', 'activeJourneys', 'emailsSent', 'conversionRate'] as const;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardDescription>{t(`cards.${key}`)}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">—</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{t('emptyHint')}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
