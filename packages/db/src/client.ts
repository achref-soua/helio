import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

/**
 * Create a Prisma client over the node-postgres driver adapter.
 *
 * Two connection roles exist by design:
 *  - the app role (`helio_app`, no BYPASSRLS) for all runtime traffic, and
 *  - the admin role (migrations, seeds) which bypasses RLS.
 * Pass the matching connection string for the context.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type { PrismaClient };
