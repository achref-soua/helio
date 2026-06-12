'use client';

import { Button } from '@helio/ui/components/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@helio/ui/components/sheet';
import { cn } from '@helio/ui/lib/utils';
import {
  AppWindow,
  BarChart3,
  Building2,
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
  PanelLeft,
  Route,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { AlertBell } from '@/components/alert-bell';
import { HelpMenu } from '@/components/help-menu';
import { ReportDialog } from '@/components/report-dialog';
import { RequireTwoFactor } from '@/components/require-two-factor';
import { SunSplash } from '@/components/sun-splash';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { usePermission } from '@/hooks/use-permission';

type NavItem = { key: string; href: string; icon: React.ComponentType<{ className?: string }> };

/** Sectioned navigation: the premium shell groups the product the way an
 *  operator thinks about it. Keys, hrefs, and data-tour anchors are
 *  unchanged so the tour and the e2e suite keep their targets. */
const NAV_SECTIONS: ReadonlyArray<{ label: string | null; items: ReadonlyArray<NavItem> }> = [
  { label: null, items: [{ key: 'dashboard', href: '/', icon: LayoutDashboard }] },
  {
    label: 'audience',
    items: [
      { key: 'contacts', href: '/contacts', icon: Users },
      { key: 'segments', href: '/segments', icon: Route },
    ],
  },
  {
    label: 'engage',
    items: [
      { key: 'emails', href: '/emails', icon: Mail },
      { key: 'campaigns', href: '/campaigns', icon: Megaphone },
      { key: 'journeys', href: '/journeys', icon: Workflow },
      { key: 'forms', href: '/forms', icon: FileText },
      { key: 'landing', href: '/landing', icon: LayoutTemplate },
      { key: 'widgets', href: '/widgets', icon: MousePointerClick },
      { key: 'inApp', href: '/in-app', icon: AppWindow },
    ],
  },
  {
    label: 'intelligence',
    items: [
      { key: 'insights', href: '/insights', icon: BarChart3 },
      { key: 'copilot', href: '/copilot', icon: Sparkles },
    ],
  },
  {
    label: 'sales',
    items: [
      { key: 'deals', href: '/deals', icon: Handshake },
      { key: 'companies', href: '/companies', icon: Building2 },
      { key: 'tasks', href: '/tasks', icon: ListTodo },
      { key: 'scheduling', href: '/scheduling', icon: CalendarClock },
    ],
  },
  {
    label: 'system',
    items: [
      { key: 'help', href: '/help', icon: CircleHelp },
      { key: 'admin', href: '/admin', icon: ShieldCheck },
      { key: 'settings', href: '/settings', icon: Settings },
    ],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  // The admin section is hidden from non-admins; the server gate on the
  // /admin layout is the actual boundary.
  const { allowed: adminAllowed } = usePermission('admin:audit');
  return (
    <nav aria-label="Primary" className="grid gap-4 px-3">
      {NAV_SECTIONS.map((section, sectionIndex) => {
        const items = section.items.filter(({ key }) => key !== 'admin' || adminAllowed);
        if (items.length === 0) return null;
        return (
          <div key={section.label ?? sectionIndex} className="grid gap-0.5">
            {section.label && (
              <p className="text-sidebar-foreground/45 px-3 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase">
                {t(`sections.${section.label}`)}
              </p>
            )}
            {items.map(({ key, href, icon: Icon }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={key}
                  href={href}
                  onClick={onNavigate}
                  data-tour={key}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  )}
                >
                  {/* The gold rail: the sun's thread marking where you are. */}
                  <span
                    aria-hidden
                    className={cn(
                      'bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full transition-opacity',
                      active ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon
                    className={cn('size-4 transition-colors', active && 'text-primary')}
                    aria-hidden
                  />
                  {t(key)}
                </Link>
              );
            })}
          </div>
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
    <Link href="/" className="group flex items-center gap-2.5 px-5">
      {brand?.logoUrl ? (
        // User-supplied logo from any host; next/image would need per-tenant
        // domain config, so a plain decorative <img> is the right tool here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="size-6 rounded object-contain" />
      ) : (
        <span className="relative inline-flex" aria-hidden>
          <Sun className="text-primary size-5 transition-transform duration-500 group-hover:rotate-45" />
          <span className="bg-primary/30 absolute inset-0 -z-10 rounded-full blur-md" />
        </span>
      )}
      <span className="font-display text-lg font-semibold tracking-tight">{name}</span>
    </Link>
  );
}

function VersionBadge({ version }: { version?: string }) {
  const t = useTranslations('app');
  if (!version) return null;
  return (
    <div className="mt-auto grid gap-3 px-5">
      <div className="gold-thread opacity-40" aria-hidden />
      <div className="text-sidebar-foreground/55 text-xs">{t('versionBadge', { version })}</div>
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
  const [sidebarHidden, setSidebarHidden] = useState(false);

  // Next frame: hydration paints first, then the saved preference applies.
  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      setSidebarHidden(localStorage.getItem('helio.sidebar.hidden') === '1'),
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  function toggleSidebar() {
    setSidebarHidden((current) => {
      const next = !current;
      localStorage.setItem('helio.sidebar.hidden', next ? '1' : '0');
      return next;
    });
  }

  return (
    <div className="flex min-h-svh">
      <SunSplash brand={brand} />
      <aside
        className={cn(
          'bg-sidebar border-sidebar-border hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r py-5',
          !sidebarHidden && 'md:flex',
        )}
      >
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
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-pressed={sidebarHidden}
            aria-label={t(sidebarHidden ? 'showSidebar' : 'hideSidebar')}
            data-testid="sidebar-toggle"
            className="hidden md:inline-flex"
          >
            <PanelLeft aria-hidden />
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <WorkspaceSwitcher />
            <AlertBell />
            <HelpMenu />
            <span data-tour="support" className="inline-flex">
              <ReportDialog />
            </span>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-6">
          <RequireTwoFactor />
          {children}
        </main>
      </div>
    </div>
  );
}
