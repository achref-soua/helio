import { redirect } from 'next/navigation';

import { authDb } from '@/lib/auth';
import { env } from '@/lib/env';

import { LoginForm } from './login-form';

// Instance state (is anyone registered yet?) must be read per request —
// this page cannot be prerendered at build time, where no database exists.
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // A brand-new install goes to first-run setup instead.
  if ((await authDb.user.count()) === 0) redirect('/setup');
  return <LoginForm showSignup={env.ALLOW_PUBLIC_SIGNUP} />;
}
