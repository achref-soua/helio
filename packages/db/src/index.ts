export { createPrismaClient, type PrismaClient } from './client';
export { compileSegmentRule, type EventConditionSets } from './segments';
// Prisma namespace (input types, DbNull markers) for callers storing JSON.
export type {
  AuditLog,
  Campaign,
  Contact,
  ContactList,
  ContactListMember,
  EmailSend,
  EmailTemplate,
  Form,
  Journey,
  JourneyRun,
  Organization,
  ProviderCredential,
  PushSubscription,
  ScoringRule,
  Segment,
  Workspace,
  WriteKey,
} from './generated/prisma/client';
export { Prisma } from './generated/prisma/client';
export {
  CampaignStatus,
  ContactStatus,
  CredentialStatus,
  EmailSendStatus,
  JourneyRunStatus,
  JourneyStatus,
  ProviderCredentialKind,
} from './generated/prisma/enums';
export { seedDemoWorkspace, type SeedSummary, type SeedTarget } from './seed-demo';
export { forTenant, type TenantClient } from './tenant';
export {
  activeContactsByEmailForWebhook,
  shopifyConnectionForWebhook,
  type ShopifyWebhookConnection,
  type SuppressibleContact,
} from './webhook-resolvers';
