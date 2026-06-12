import { redirect } from 'next/navigation';

import { authDb } from '@/lib/auth';

import { SetupWizard } from './setup-wizard';

// Instance state (is anyone registered yet?) must be read per request —
// this page cannot be prerendered at build time, where no database exists.
export const dynamic = 'force-dynamic';

/** First-run only: the moment a user exists, this page is gone. */
export default async function SetupPage() {
  const users = await authDb.user.count();
  if (users > 0) redirect('/login');
  return <SetupWizard />;
}
