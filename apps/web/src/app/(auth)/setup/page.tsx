import { redirect } from 'next/navigation';

import { authDb } from '@/lib/auth';

import { SetupWizard } from './setup-wizard';

/** First-run only: the moment a user exists, this page is gone. */
export default async function SetupPage() {
  const users = await authDb.user.count();
  if (users > 0) redirect('/login');
  return <SetupWizard />;
}
