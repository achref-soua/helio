'use client';

import { Button } from '@helio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** The browser's install prompt, when one is offered. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * "Install the app" (K2): Helio is a PWA — installable with its own icon
 * and window. Chromium browsers hand us a real install prompt; everywhere
 * else the dialog explains the browser-menu route.
 */
export function InstallAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('help.install');
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="install-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="text-muted-foreground grid gap-2 text-sm">
          <p>{t('chrome')}</p>
          <p>{t('safari')}</p>
          <p>{t('android')}</p>
        </div>
        <DialogFooter>
          {prompt && (
            <Button
              onClick={async () => {
                await prompt.prompt();
                setPrompt(null);
                onOpenChange(false);
              }}
            >
              {t('installNow')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
