import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { auth } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Authoritative session check; the proxy only does an optimistic
  // cookie-presence redirect.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/login');
  }
  return <AppShell>{children}</AppShell>;
}
