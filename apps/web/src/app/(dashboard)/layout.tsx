import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { auth } from '@/lib/auth';

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
  return <AppShell>{children}</AppShell>;
}
