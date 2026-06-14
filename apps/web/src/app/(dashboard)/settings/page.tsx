import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { auth } from '@/lib/auth';

import { AboutPanel } from './about-panel';
import { AnalyticsPanel } from './analytics-panel';
import { ApiKeysPanel } from './api-keys-panel';
import { BackupsPanel } from './backups-panel';
import { BrandingPanel } from './branding-panel';
import { ChurnModelPanel } from './churn-model-panel';
import { CredentialsPanel } from './credentials-panel';
import { DeliverabilityPanel } from './deliverability-panel';
import { IntegrationsPanel } from './integrations-panel';
import { MembersPanel } from './members-panel';
import { PasswordPolicyPanel } from './password-policy-panel';
import { ScimPanel } from './scim-panel';
import { SecurityPanel } from './security-panel';
import { SsoPanel } from './sso-panel';
import { SupportPanel } from './support-panel';
import { UpdatesPanel } from './updates-panel';
import { WebhooksPanel } from './webhooks-panel';

/**
 * One labelled band of related settings. The cards still flow two-up on wide
 * screens (grid-cols-1 pins the track to minmax(0,1fr) so narrow phones never
 * scroll sideways), but a titled header turns the old undifferentiated wall
 * into something you can scan.
 */
function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid scroll-mt-6 gap-4">
      <div className="border-border/70 border-b pb-2.5">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {/* Masonry (CSS columns) instead of a 2-up grid: cards pack tightly by
          height, so a short card next to a tall one no longer leaves a ragged
          gap. break-inside-avoid keeps each card whole; mb gives the rhythm. */}
      <div className="gap-5 [column-fill:balance] xl:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid [&>*:last-child]:mb-0">
        {children}
      </div>
    </section>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ enroll2fa?: string }>;
}) {
  const { enroll2fa } = await searchParams;
  const requestHeaders = await headers();
  const [t, ts, organization, session] = await Promise.all([
    getTranslations('members'),
    getTranslations('settingsSections'),
    auth.api.getFullOrganization({ headers: requestHeaders }),
    auth.api.getSession({ headers: requestHeaders }),
  ]);
  if (!organization || !session) {
    redirect('/onboarding');
  }

  const me = organization.members.find((member) => member.userId === session.user.id);
  const canAdmin = me?.role === 'owner' || me?.role === 'admin';
  const isOwner = me?.role === 'owner';

  return (
    <div className="grid grid-cols-1 gap-10">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle', { org: organization.name })}</p>
      </div>

      <SettingsSection title={ts('teamTitle')} description={ts('teamDesc')}>
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
          canManage={canAdmin}
        />
        <SecurityPanel autoEnroll={enroll2fa === '1'} />
        {canAdmin && <PasswordPolicyPanel canManage />}
        {canAdmin && <SsoPanel canManage />}
        {canAdmin && <ScimPanel canManage />}
        {canAdmin && <ApiKeysPanel canManage />}
      </SettingsSection>

      {canAdmin && (
        <SettingsSection title={ts('channelsTitle')} description={ts('channelsDesc')}>
          <CredentialsPanel canManage />
          <DeliverabilityPanel canManage />
          <WebhooksPanel canManage />
          <IntegrationsPanel canManage />
        </SettingsSection>
      )}

      {canAdmin && (
        <SettingsSection title={ts('workspaceTitle')} description={ts('workspaceDesc')}>
          <BrandingPanel canManage />
          <AnalyticsPanel canManage />
          <ChurnModelPanel canManage />
        </SettingsSection>
      )}

      <SettingsSection title={ts('maintenanceTitle')} description={ts('maintenanceDesc')}>
        {canAdmin && <BackupsPanel isOwner={isOwner} />}
        <UpdatesPanel />
        {canAdmin && <SupportPanel canManage />}
        <AboutPanel />
      </SettingsSection>
    </div>
  );
}
