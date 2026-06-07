export { createPrismaClient, type PrismaClient } from './client';
export type { AuditLog, Organization, Workspace } from './generated/prisma/client';
export { forTenant, type TenantClient } from './tenant';
