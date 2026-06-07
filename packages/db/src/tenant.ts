import type { PrismaClient } from './generated/prisma/client';

/**
 * Scope a Prisma client to one organization for the duration of each query.
 *
 * Every operation is wrapped in a transaction that first sets the
 * `app.org_id` setting (transaction-local via `set_config(..., true)`);
 * the Postgres RLS policies key on that setting. Queries made through the
 * returned client can only ever see or touch rows of the given org —
 * enforced by the database, not by query discipline.
 */
export function forTenant(prisma: PrismaClient, organizationId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.org_id', ${organizationId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forTenant>;
