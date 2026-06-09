import { forTenant } from '@helio/db';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { BrandStyle } from '@/components/brand-style';
import { TourGuide } from '@/components/tour-guide';
import { auth } from '@/lib/auth';
import { appDb } from '@/lib/db';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Authoritative session check; the proxy only does an optimistic
  // cookie-presence redirect.
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect('/login');
  }
  // First run: no organization yet → onboarding creates one.
  const organizations = await auth.api.listOrganizations({ headers: requestHeaders });
  if (organizations.length === 0) {
    redirect('/onboarding');
  }

  // White-label the shell with the active org's branding (one PK lookup,
  // RLS-scoped to the org the session is acting in).
  const activeOrgId = session.session.activeOrganizationId ?? organizations[0]?.id;
  const org = activeOrgId
    ? await forTenant(appDb, activeOrgId).organization.findUnique({
        where: { id: activeOrgId },
        select: { name: true, brandName: true, brandColor: true, logo: true },
      })
    : null;

  return (
    <>
      <BrandStyle color={org?.brandColor} />
      <AppShell brand={org ? { name: org.brandName ?? org.name, logoUrl: org.logo } : undefined}>
        {children}
      </AppShell>
      <TourGuide />
    </>
  );
}
