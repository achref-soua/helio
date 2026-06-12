import { type MappedNormalizeResult, newId } from '@helio/core';
import { forTenant, type Prisma } from '@helio/db';

import { appDb } from './db';

/**
 * The background half of the import wizard (I1) — also the pipeline the
 * API connectors feed (I2/I3). Runs detached from the request: the tRPC
 * mutation creates the job RUNNING and returns; this updates the row
 * chunk by chunk so the dashboard's poll shows live progress. Any throw
 * marks the job FAILED with a readable reason — never a stuck RUNNING.
 */

const CHUNK = 500;

export interface ImportPlan {
  organizationId: string;
  workspaceId: string;
  jobId: string;
  normalized: MappedNormalizeResult;
  updateExisting: boolean;
}

export async function runImportJob(plan: ImportPlan): Promise<void> {
  const tenantDb = forTenant(appDb, plan.organizationId);
  const { normalized } = plan;
  try {
    // Companies first: match by exact name per workspace, create the rest.
    const companyIds = new Map<string, string>();
    if (normalized.companies.length > 0) {
      const existing = await tenantDb.company.findMany({
        where: { workspaceId: plan.workspaceId, name: { in: normalized.companies } },
        select: { id: true, name: true },
      });
      for (const company of existing) companyIds.set(company.name, company.id);
      const missing = normalized.companies.filter((name) => !companyIds.has(name));
      for (const name of missing) {
        const company = await tenantDb.company.create({
          data: {
            id: newId('co'),
            organizationId: plan.organizationId,
            workspaceId: plan.workspaceId,
            name,
          },
        });
        companyIds.set(name, company.id);
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (let start = 0; start < normalized.valid.length; start += CHUNK) {
      const chunk = normalized.valid.slice(start, start + CHUNK);
      const emails = chunk.map((row) => row.email);
      const existing = await tenantDb.contact.findMany({
        where: { workspaceId: plan.workspaceId, email: { in: emails } },
        select: { id: true, email: true },
      });
      const existingByEmail = new Map(existing.map((row) => [row.email, row.id]));

      const fresh = chunk.filter((row) => !existingByEmail.has(row.email));
      if (fresh.length > 0) {
        const result = await tenantDb.contact.createMany({
          data: fresh.map((row) => ({
            id: newId('contact'),
            organizationId: plan.organizationId,
            workspaceId: plan.workspaceId,
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            status: row.status ?? 'ACTIVE',
            attributes: row.attributes,
            companyId: row.company ? companyIds.get(row.company) : undefined,
            source: `${normalized.source}-import`,
          })),
          skipDuplicates: true,
        });
        created += result.count;
      }

      for (const row of chunk) {
        const contactId = existingByEmail.get(row.email);
        if (!contactId) continue;
        if (!plan.updateExisting) {
          skipped += 1;
          continue;
        }
        await tenantDb.contact.update({
          where: { id: contactId },
          data: {
            firstName: row.firstName ?? undefined,
            lastName: row.lastName ?? undefined,
            // An incoming UNSUBSCRIBED always sticks; never resubscribe.
            ...(row.status === 'UNSUBSCRIBED' ? { status: 'UNSUBSCRIBED' as const } : {}),
            ...(Object.keys(row.attributes).length > 0
              ? { attributes: row.attributes as Prisma.InputJsonValue }
              : {}),
            ...(row.company ? { companyId: companyIds.get(row.company) } : {}),
          },
        });
        updated += 1;
      }

      await tenantDb.importJob.update({
        where: { id: plan.jobId },
        data: { created, updated, skipped },
      });
    }

    await tenantDb.importJob.update({
      where: { id: plan.jobId },
      data: { status: 'DONE', created, updated, skipped, finishedAt: new Date() },
    });
  } catch (error) {
    await tenantDb.importJob
      .update({
        where: { id: plan.jobId },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message.slice(0, 500) : 'import failed',
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }
}
