import { can } from '@helio/core';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { auth, authDb } from '@/lib/auth';

import { AdminNav } from './admin-nav';

/**
 * The admin area: server-gated on the permission matrix (the client-side
 * nav hiding is convenience; this is the boundary). Sub-pages share the
 * section nav.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const organizationId = session?.session.activeOrganizationId;
  if (!session || !organizationId) redirect('/login');
  const member = await authDb.member.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.user.id } },
    select: { role: true },
  });
  if (!can(member?.role ?? '', 'admin:audit')) redirect('/');

  const t = await getTranslations('admin');
  return (
    <div className="grid max-w-5xl grid-cols-1 gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
