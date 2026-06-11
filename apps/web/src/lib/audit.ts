import { newId } from '@helio/core';
import { type Prisma, type TenantClient } from '@helio/db';

/** The audit-capable slice of the tenant client. */
type AuditWriter = Pick<TenantClient, 'auditLog'>;

export interface AuditEntry {
  organizationId: string;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * One audit row, one shape, everywhere — routers pass `ctx.tenantDb`, the
 * auth hook passes a freshly-scoped tenant client. Throws on failure:
 * an admin operation that cannot be audited should not silently succeed
 * (the auth hook catches, because failing a sign-in over audit storage
 * would be worse).
 */
export async function writeAudit(db: AuditWriter, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId: entry.organizationId,
      workspaceId: entry.workspaceId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
