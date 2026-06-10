'use client';

import { Button } from '@helio/ui/components/button';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { startProductTour } from '@/components/tour-guide';

/** The usage guide's client island: replays the onboarding tour. */
export function TakeTourButton() {
  const t = useTranslations('help');
  return (
    <Button onClick={startProductTour} data-testid="guide-tour">
      <Sparkles aria-hidden /> {t('takeTour')}
    </Button>
  );
}
