export { createPrismaClient, type PrismaClient } from './client';
export { compileSegmentRule } from './segments';
// Prisma namespace (input types, DbNull markers) for callers storing JSON.
export type {
  AuditLog,
  Contact,
  ContactList,
  ContactListMember,
  EmailTemplate,
  Organization,
  Segment,
  Workspace,
  WriteKey,
} from './generated/prisma/client';
export { Prisma } from './generated/prisma/client';
export { ContactStatus } from './generated/prisma/enums';
export { forTenant, type TenantClient } from './tenant';
