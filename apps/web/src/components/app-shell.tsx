'use client';

import { Button } from '@helio/ui/components/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@helio/ui/components/sheet';
import { cn } from '@helio/ui/lib/utils';
import {
  AppWindow,
  BarChart3,
  CalendarClock,
  CircleHelp,
  FileText,
  Handshake,
  LayoutDashboard,
  LayoutTemplate,
  ListTodo,
  Mail,
  Megaphone,
  Menu,
  MousePointerClick,
  Route,
  Settings,
  Sparkles,
  Sun,
  Users,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { HelpMenu } from '@/components/help-menu';
import { ReportDialog } from '@/components/report-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

const NAV_ITEMS = [
  { key: 'dashboard', href: '/', icon: LayoutDashboard },
  { key: 'contacts', href: '/contacts', icon: Users },
  { key: 'segments', href: '/segments', icon: Route },
  { key: 'emails', href: '/emails', icon: Mail },
  { key: 'campaigns', href: '/campaigns', icon: Megaphone },
  { key: 'forms', href: '/forms', icon: FileText },
  { key: 'landing', href: '/landing', icon: LayoutTemplate },
  { key: 'widgets', href: '/widgets', icon: MousePointerClick },
  { key: 'inApp', href: '/in-app', icon: AppWindow },
  { key: 'journeys', href: '/journeys', icon: Workflow },
  { key: 'insights', href: '/insights', icon: BarChart3 },
  { key: 'deals', href: '/deals', icon: Handshake },
  { key: 'tasks', href: '/tasks', icon: ListTodo },
  { key: 'scheduling', href: '/scheduling', icon: CalendarClock },
  { key: 'copilot', href: '/copilot', icon: Sparkles },
  { key: 'help', href: '/help', icon: CircleHelp },
  { key: 'settings', href: '/settings', icon: Settings },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="grid gap-1 px-2">
      {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

export interface BrandMark {
  name: string | null;
  logoUrl: string | null;
}

function Wordmark({ brand }: { brand?: BrandMark }) {
  const t = useTranslations('app');
  const name = brand?.name || t('name');
  return (
    <Link href="/" className="flex items-center gap-2 px-4 font-semibold">
      {brand?.logoUrl ? (
        // User-supplied logo from any host; next/image would need per-tenant
        // domain config, so a plain decorative <img> is the right tool here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="size-5 rounded object-contain" />
      ) : (
        <Sun className="text-primary size-5" aria-hidden />
      )}
      {name}
    </Link>
  );
}

function VersionBadge({ version }: { version?: string }) {
  const t = useTranslations('app');
  if (!version) return null;
  return (
    <div className="text-sidebar-foreground/50 mt-auto px-4 text-xs">
      {t('versionBadge', { version })}
    </div>
  );
}

export function AppShell({
  children,
  brand,
  version,
}: {
  children: React.ReactNode;
  brand?: BrandMark;
  version?: string;
}) {
  const t = useTranslations('nav');
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar border-sidebar-border hidden w-60 shrink-0 flex-col gap-6 border-r py-4 md:flex">
        <Wordmark brand={brand} />
        <NavLinks />
        <VersionBadge version={version} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu aria-hidden />
                <span className="sr-only">{t('toggleNavigation')}</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 pt-10">
              <SheetTitle className="sr-only">{t('toggleNavigation')}</SheetTitle>
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="ml-auto flex items-center gap-1">
            <WorkspaceSwitcher />
            <HelpMenu />
            <ReportDialog />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
