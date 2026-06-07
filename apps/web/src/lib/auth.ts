import { apiKey } from '@better-auth/api-key';
import { createPrismaClient } from '@helio/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { organization, twoFactor } from 'better-auth/plugins';

import { env } from './env';
import { sendMail } from './mailer';

/**
 * The auth kernel. Connects with the admin role (ADR-0004): Better-Auth
 * enforces membership and session integrity itself, while every domain
 * data path goes through the RLS-bound forTenant() client instead.
 */
const prisma = createPrismaClient(env.DATABASE_ADMIN_URL);

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
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
  plugins: [
    organization({
      sendInvitationEmail: async (data) => {
        const inviteUrl = `${env.APP_URL}/accept-invitation/${data.id}`;
        await sendMail({
          to: data.email,
          subject: `Join ${data.organization.name} on Helio`,
          text: `${data.inviter.user.name || data.inviter.user.email} invited you to ${data.organization.name}: ${inviteUrl}`,
        });
      },
    }),
    twoFactor(),
    apiKey(),
    // Must stay last: makes Better-Auth set cookies in server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
