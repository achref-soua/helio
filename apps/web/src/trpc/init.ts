import { can, hasRole, type Permission, type Role } from '@helio/core';
import { forTenant } from '@helio/db';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';

import { auth, authDb } from '@/lib/auth';
import { appDb } from '@/lib/db';

export async function createTRPCContext(options: { headers: Headers }) {
  const session = await auth.api.getSession({ headers: options.headers });
  // Headers are carried so procedures can call back into the auth kernel
  // (e.g. the SSO router's registerSSOProvider) with the caller's session.
  return { session, appDb, headers: options.headers };
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
export const orgProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const organizationId = ctx.session.session.activeOrganizationId;
  if (!organizationId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' });
  }
  // Membership role comes from the auth kernel — the RLS app role is
  // deliberately denied access to identity tables.
  const member = await authDb.member.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: ctx.session.user.id },
    },
    select: { role: true },
  });
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
  }
  return next({
    ctx: {
      ...ctx,
      organizationId,
      memberRole: member.role,
      tenantDb: forTenant(ctx.appDb, organizationId),
    },
  });
});

/** Gate an org procedure behind a minimum role. */
export function requireRole(role: string, required: Role) {
  if (!hasRole(role, required)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${required} access` });
  }
}

/**
 * Gate an org procedure behind a named permission (the catalog in
 * @helio/core). Prefer this over requireRole: the name documents the
 * action, and the admin area can answer "who can do what" from it.
 */
export function requirePermission(role: string, permission: Permission) {
  if (!can(role, permission)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Your role does not include the ${permission} permission`,
    });
  }
}
