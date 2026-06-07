'use client';

import { Toaster } from '@helio/ui/components/sonner';
import { TooltipProvider } from '@helio/ui/components/tooltip';
import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  );
}
