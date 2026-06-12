import { newId } from '@helio/core';
import type { PrismaClient } from '@helio/db';
import { forTenant, seedDemoWorkspace } from '@helio/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { auth, authDb } from '@/lib/auth';
import { appDb } from '@/lib/db';
import { seedDemoEvents } from '@/lib/demo-events';
import { env } from '@/lib/env';
import { checkPublicRateLimit } from '@/lib/public-rate-limit';

import { publicProcedure, router } from '../init';

/**
 * First-run setup (K1). A fresh install has zero users; exactly one
 * bootstrap call may create the first admin (auto-verified — there is no
 * email loop before an email provider exists), their organization, and
 * the first workspace. The moment a user exists, every procedure here
 * locks shut — the wizard page itself redirects away too.
 */

async function instanceIsFresh(): Promise<boolean> {
  return (await authDb.user.count()) === 0;
}

export const setupRouter = router({
  status: publicProcedure.query(async () => ({
    fresh: await instanceIsFresh(),
    signupAllowed: env.ALLOW_PUBLIC_SIGNUP,
  })),

  bootstrap: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().pipe(z.string().email()),
        password: z.string().min(10).max(200),
        organizationName: z.string().trim().min(1).max(120),
        seedDemo: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const decision = await checkPublicRateLimit('setup', 'instance');
      if (!decision.allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Slow down and retry shortly' });
      }
      if (!(await instanceIsFresh())) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This instance is already set up' });
      }

      // The auth kernel creates the user (hashing, account row); the
      // fresh-install path then verifies the address directly — there is
      // no mail provider yet, so a verification loop would dead-end.
      await auth.api.signUpEmail({
        body: { name: input.name, email: input.email, password: input.password },
      });
      const user = await authDb.user.findUnique({ where: { email: input.email } });
      if (!user) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'signup failed' });
      await authDb.user.update({ where: { id: user.id }, data: { emailVerified: true } });

      const organizationId = newId('org');
      const slugBase = input.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40);
      await authDb.organization.create({
        data: {
          id: organizationId,
          name: input.organizationName,
          slug: slugBase || `org-${organizationId.slice(-6)}`,
          createdAt: new Date(),
        },
      });
      await authDb.member.create({
        data: {
          id: newId('mem'),
          organizationId,
          userId: user.id,
          role: 'owner',
          createdAt: new Date(),
        },
      });

      const tenantDb = forTenant(appDb, organizationId);
      const workspaceId = newId('ws');
      await tenantDb.workspace.create({
        data: {
          id: workspaceId,
          organizationId,
          name: 'Default',
          slug: 'default',
        },
      });

      // Sample data lands in THIS organization's workspace, so the very
      // first sign-in opens on a full product instead of empty lists.
      if (input.seedDemo) {
        await seedDemoWorkspace(tenantDb as unknown as PrismaClient, {
          organizationId,
          workspaceId,
        });
        // Behavioral history for the analytics surfaces — silently zero
        // rows on the core profile, where ClickHouse doesn't run.
        await seedDemoEvents(tenantDb as unknown as PrismaClient, {
          organizationId,
          workspaceId,
        });
      }

      await tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId,
          actorId: user.id,
          action: 'instance.setup_completed',
          targetType: 'organization',
          targetId: organizationId,
        },
      });

      return { ok: true, organizationId, workspaceId };
    }),
});
