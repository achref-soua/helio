import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import {
  ArrowRight,
  BarChart3,
  FileText,
  Handshake,
  LifeBuoy,
  Mail,
  Megaphone,
  Route,
  Settings,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { TakeTourButton } from '@/components/take-tour-button';

const SECTIONS = [
  { key: 'contacts', href: '/contacts', icon: Users },
  { key: 'segments', href: '/segments', icon: Route },
  { key: 'emails', href: '/emails', icon: Mail },
  { key: 'campaigns', href: '/campaigns', icon: Megaphone },
  { key: 'journeys', href: '/journeys', icon: Workflow },
  { key: 'growth', href: '/forms', icon: FileText },
  { key: 'insights', href: '/insights', icon: BarChart3 },
  { key: 'copilot', href: '/copilot', icon: Sparkles },
  { key: 'crm', href: '/deals', icon: Handshake },
  { key: 'settings', href: '/settings', icon: Settings },
] as const;

/**
 * The in-app usage guide: a feature-by-feature "how do I…" map of the
 * product, with a way back into the onboarding tour. Static content —
 * deeper recipes live in the docs site this page links to.
 */
export default async function HelpPage() {
  const t = await getTranslations('help');
  return (
    <div className="mx-auto grid max-w-4xl gap-6" data-testid="usage-guide">
      <header className="grid gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('guide.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('guide.subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <TakeTourButton />
        <Button variant="outline" asChild>
          <a href="https://github.com/achref-soua/helio" target="_blank" rel="noreferrer">
            {t('documentation')}
          </a>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ key, href, icon: Icon }) => (
          <Card key={key}>
            <CardContent className="grid gap-2 py-5">
              <div className="flex items-center gap-2">
                <Icon className="text-primary size-5" aria-hidden />
                <h2 className="font-semibold">{t(`guide.sections.${key}.title`)}</h2>
              </div>
              <p className="text-muted-foreground text-sm">{t(`guide.sections.${key}.body`)}</p>
              <Link
                href={href}
                className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
              >
                {t(`guide.sections.${key}.cta`)} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <LifeBuoy className="size-4" aria-hidden />
        {t('guide.support')}
      </p>
    </div>
  );
}
