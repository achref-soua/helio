import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';

import { BillingPanel } from './billing-panel';
import { MembersPanel } from './members-panel';
import { SsoPanel } from './sso-panel';

export default async function SettingsPage() {
  const requestHeaders = await headers();
  const [t, organization, session] = await Promise.all([
    getTranslations('members'),
    auth.api.getFullOrganization({ headers: requestHeaders }),
    auth.api.getSession({ headers: requestHeaders }),
  ]);
  if (!organization || !session) {
    redirect('/onboarding');
  }

  const me = organization.members.find((member) => member.userId === session.user.id);

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle', { org: organization.name })}</p>
      </div>
      <MembersPanel
        members={organization.members.map((member) => ({
          id: member.id,
          role: member.role,
          name: member.user.name,
          email: member.user.email,
        }))}
        invitations={organization.invitations
          .filter((invitation) => invitation.status === 'pending')
          .map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role ?? 'viewer',
          }))}
        canManage={me?.role === 'owner' || me?.role === 'admin'}
      />
      <BillingPanel />
      {(me?.role === 'owner' || me?.role === 'admin') && <SsoPanel canManage />}
    </div>
  );
}
