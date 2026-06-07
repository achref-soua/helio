'use client';

import { Button } from '@helio/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const t = useTranslations('theme');
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Sun
            aria-hidden
            className="size-4.5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
          />
          <Moon
            aria-hidden
            className="absolute size-4.5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
          />
          <span className="sr-only">{t('toggle')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>{t('light')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>{t('dark')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>{t('system')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
