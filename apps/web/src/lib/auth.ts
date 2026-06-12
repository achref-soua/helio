import { apiKey } from '@better-auth/api-key';
import { sso } from '@better-auth/sso';
import { createPrismaClient, forTenant } from '@helio/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { organization, twoFactor } from 'better-auth/plugins';

import { writeAudit } from './audit';
import { appDb } from './db';
import { env } from './env';
import { sendMail } from './mailer';
import { ac, roles } from './permissions';

/** Auth-kernel paths that land in the organization audit log. */
const AUDITED_AUTH_PATHS: Record<string, { action: string; targetType?: string }> = {
  '/sign-in/email': { action: 'auth.signed_in' },
  '/two-factor/enable': { action: 'auth.two_factor_enabled' },
  '/two-factor/disable': { action: 'auth.two_factor_disabled' },
  '/change-password': { action: 'auth.password_changed' },
  '/organization/update-member-role': { action: 'member.role_changed', targetType: 'member' },
  '/organization/remove-member': { action: 'member.removed', targetType: 'member' },
  '/organization/invite-member': { action: 'member.invited', targetType: 'invitation' },
  '/organization/cancel-invitation': {
    action: 'member.invitation_canceled',
    targetType: 'invitation',
  },
};

/**
 * The auth kernel. Connects with the admin role (ADR-0004): Better-Auth
 * enforces membership and session integrity itself, while every domain
 * data path goes through the RLS-bound forTenant() client instead.
 */
const prisma = createPrismaClient(env.DATABASE_ADMIN_URL);

/**
 * Kernel-side database handle. Exclusively for auth-domain reads that the
 * RLS app role is deliberately denied (e.g. membership role lookups).
 */
export const authDb = prisma;

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  // Brute-force damping on the auth surface (active in production, like the
  // rest of Better-Auth's limiter; in-memory, so per replica). The global
  // budget stays roomy for session/organization chatter behind a corporate
  // NAT; the credential endpoints — the actual guessing targets — get tight
  // ones.
  rateLimit: {
    window: 60,
    max: 120,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 10 },
      '/forget-password': { window: 300, max: 5 },
      '/two-factor/verify-totp': { window: 60, max: 10 },
      '/two-factor/verify-backup-code': { window: 60, max: 10 },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: 'Reset your Helio password',
        text: `Reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: 'Verify your Helio email',
        text: `Welcome to Helio! Verify your email: ${url}`,
      });
    },
  },
  hooks: {
    // Invite-only enforcement (K1): when public signup is off, the only
    // account creation paths are invitations and the first-run setup
    // (which runs while the instance has zero users).
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email' || env.ALLOW_PUBLIC_SIGNUP) return;
      const users = await prisma.user.count().catch(() => 1);
      if (users > 0) {
        throw new APIError('FORBIDDEN', {
          message: 'Signups are invite-only on this Helio — ask an admin for an invitation.',
        });
      }
    }),
    // Security-relevant auth events land in the org audit log (G2). The
    // hook only runs after a SUCCESSFUL handler, and auditing is
    // best-effort here — failing a sign-in over audit storage would be
    // worse than a missing row.
    after: createAuthMiddleware(async (ctx) => {
      const audited = AUDITED_AUTH_PATHS[ctx.path];
      if (!audited) return;
      try {
        const session = ctx.context.newSession ?? (await getSessionFromCtx(ctx));
        if (!session) return;
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const organizationId =
          (typeof body.organizationId === 'string' && body.organizationId) ||
          session.session.activeOrganizationId;
        if (!organizationId) return;
        const targetId =
          (typeof body.memberId === 'string' && body.memberId) ||
          (typeof body.invitationId === 'string' && body.invitationId) ||
          (typeof body.email === 'string' && body.email) ||
          undefined;
        const role = typeof body.role === 'string' ? body.role : undefined;
        await writeAudit(forTenant(appDb, organizationId), {
          organizationId,
          actorId: session.user.id,
          action: audited.action,
          targetType: audited.targetType,
          targetId,
          metadata: role ? { role } : undefined,
        });
      } catch {
        // Never let auditing break the auth flow.
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // New sessions start scoped to the user's first organization so
        // org-scoped pages and procedures work right after login.
        before: async (session) => {
          const member = await prisma.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: 'asc' },
            select: { organizationId: true },
          });
          return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: 'owner',
      sendInvitationEmail: async (data) => {
        const inviteUrl = `${env.APP_URL}/accept-invitation/${data.id}`;
        await sendMail({
          to: data.email,
          subject: `Join ${data.organization.name} on Helio`,
          text: `${data.inviter.user.name || data.inviter.user.email} invited you to ${data.organization.name}: ${inviteUrl}`,
          // Invites go out through the org's own email provider when one
          // is connected, so they carry the org's From identity.
          organizationId: data.organization.id,
        });
      },
    }),
    twoFactor(),
    apiKey(),
    // Enterprise single sign-on (OIDC). Providers are registered per
    // organization (see the sso tRPC router); a user who authenticates
    // through an org's provider is provisioned into that org as the
    // least-privileged role, which an admin can then elevate (ADR-0013).
    sso({
      organizationProvisioning: {
        disabled: false,
        // Helio's org roles are owner/admin/editor/viewer (@helio/core); SSO
        // users join as the least-privileged viewer, which an admin elevates.
        // The plugin's type only models Better-Auth's built-in member/admin
        // roles, but writes this value verbatim to member.role, so we assert
        // the role our application layer actually understands.
        defaultRole: 'viewer' as string as 'member',
      },
    }),
    // Must stay last: makes Better-Auth set cookies in server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
