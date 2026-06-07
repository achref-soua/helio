import { forTenant } from '@helio/db';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';

import { auth } from '@/lib/auth';
import { appDb } from '@/lib/db';

export async function createTRPCContext(options: { headers: Headers }) {
  const session = await auth.api.getSession({ headers: options.headers });
  return { session, appDb };
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/**
 * Procedures that operate on tenant data. Requires an active organization
 * on the session and provides an RLS-scoped client — handlers physically
 * cannot reach other tenants' rows.
 */
export const orgProcedure = protectedProcedure.use(({ ctx, next }) => {
  const organizationId = ctx.session.session.activeOrganizationId;
  if (!organizationId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' });
  }
  return next({
    ctx: { ...ctx, organizationId, tenantDb: forTenant(ctx.appDb, organizationId) },
  });
});
