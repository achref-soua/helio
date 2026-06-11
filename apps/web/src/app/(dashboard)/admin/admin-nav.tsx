'use client';

import { cn } from '@helio/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

// System health (G5) appends here when it lands.
const SECTIONS = [
  { key: 'audit', href: '/admin/audit' },
  { key: 'reports', href: '/admin/reports' },
] as const;

export function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex gap-1 border-b">
      {SECTIONS.map(({ key, href }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
