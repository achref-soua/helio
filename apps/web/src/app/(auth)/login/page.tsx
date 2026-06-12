import { redirect } from 'next/navigation';

import { authDb } from '@/lib/auth';
import { env } from '@/lib/env';

import { LoginForm } from './login-form';

export default async function LoginPage() {
  // A brand-new install goes to first-run setup instead.
  if ((await authDb.user.count()) === 0) redirect('/setup');
  return <LoginForm showSignup={env.ALLOW_PUBLIC_SIGNUP} />;
}
