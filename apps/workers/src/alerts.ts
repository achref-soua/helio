import { newId } from '@helio/core';
import type { Prisma, PrismaClient } from '@helio/db';

/**
 * Raise an operational alert for an organization (shown in the dashboard
 * bell). Dedupes against an unread alert carrying the same context key so
 * Temporal retries don't stack copies — and never throws: alerting must
 * not break the send pipeline it reports on.
 */
export async function raiseOrgAlert(
  prisma: PrismaClient,
  organizationId: string,
  kind: string,
  message: string,
  context: Record<string, unknown>,
  dedupe?: { path: string[]; equals: string },
): Promise<void> {
  try {
    if (dedupe) {
      const existing = await prisma.systemAlert.findFirst({
        where: {
          organizationId,
          kind,
          readAt: null,
          context: { path: dedupe.path, equals: dedupe.equals },
        },
        select: { id: true },
      });
      if (existing) return;
    }
    await prisma.systemAlert.create({
      data: {
        id: newId('alert'),
        organizationId,
        kind,
        message,
        context: context as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Best-effort by design.
  }
}
