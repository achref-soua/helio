'use client';

import { Button } from '@helio/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { BookOpen, CircleHelp, ExternalLink, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { startProductTour } from '@/components/tour-guide';

const REPO_URL = 'https://github.com/achref-soua/helio';

/** Top-bar help: restart the product tour, open the usage guide, or the docs. */
export function HelpMenu() {
  const t = useTranslations('help');
  return (
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
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> {t('documentation')}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
