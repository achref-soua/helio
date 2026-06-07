import { createPrismaClient, type PrismaClient } from '@helio/db';

import { env } from './env';

/**
 * Runtime (RLS-bound) Prisma client for domain data. One instance per
 * process; scope it per request with forTenant().
 */
const globalForPrisma = globalThis as unknown as { appDb?: PrismaClient };

export const appDb: PrismaClient = globalForPrisma.appDb ?? createPrismaClient(env.DATABASE_URL);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.appDb = appDb;
}
