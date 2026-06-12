'use client';

import { Button } from '@helio/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { BookOpen, CircleHelp, ExternalLink, MonitorDown, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { InstallAppDialog } from '@/components/install-app-dialog';
import { startProductTour } from '@/components/tour-guide';

const REPO_URL = 'https://github.com/achref-soua/helio';

/** Top-bar help: restart the product tour, open the usage guide, or the docs. */
export function HelpMenu() {
  const t = useTranslations('help');
  const [installOpen, setInstallOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('open')} data-testid="help-open">
            <CircleHelp aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={startProductTour} data-testid="help-tour">
            <Sparkles aria-hidden /> {t('takeTour')}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/help" data-testid="help-guide">
              <BookOpen aria-hidden /> {t('usageGuide')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setInstallOpen(true)} data-testid="help-install">
            <MonitorDown aria-hidden /> {t('installApp')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden /> {t('documentation')}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <InstallAppDialog open={installOpen} onOpenChange={setInstallOpen} />
    </>
  );
}
