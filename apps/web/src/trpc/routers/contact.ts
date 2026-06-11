import { contactEmailSchema, contactsToCsv, newId, normalizeContactRows } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getClickHouse } from '@/lib/clickhouse';
import { pushContactToSalesforce } from '@/lib/salesforce';
import { emitWebhookEvent } from '@/lib/webhooks';

import { orgProcedure, requireRole, router } from '../init';

const attributesSchema = z.record(z.string(), z.string()).default({});

/** One CSV export tops out here; the audit row records any truncation. */
const EXPORT_CAP = 10_000;

/** Resolve and authorize the workspace inside the tenant scope. */
async function assertWorkspace(
  tenantDb: { workspace: { findUnique: (args: { where: { id: string } }) => Promise<unknown> } },
  workspaceId: string,
) {
  const workspace = await tenantDb.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }
}

export const contactRouter = router({
  list: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        search: z.string().trim().max(120).optional(),
        listId: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        workspaceId: input.workspaceId,
        ...(input.listId ? { listMembers: { some: { listId: input.listId } } } : {}),
        ...(input.search
          ? {
              OR: [
                { email: { contains: input.search, mode: 'insensitive' as const } },
                { firstName: { contains: input.search, mode: 'insensitive' as const } },
                { lastName: { contains: input.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const items = await ctx.tenantDb.contact.findMany({
        where,
        orderBy: { id: 'desc' },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      // The +1th row only signals another page; the cursor must be the
      // last row we keep (skip:1 then resumes at the row we popped).
      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();
      const nextCursor = hasMore ? items.at(-1)!.id : null;
      const total = await ctx.tenantDb.contact.count({
        where: { workspaceId: input.workspaceId },
      });
      return { items, nextCursor, total };
    }),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        email: contactEmailSchema,
        phone: z.string().trim().max(32).optional(),
        firstName: z.string().trim().max(80).optional(),
        lastName: z.string().trim().max(80).optional(),
        attributes: attributesSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      await assertWorkspace(ctx.tenantDb, input.workspaceId);
      const existing = await ctx.tenantDb.contact.findFirst({
        where: { workspaceId: input.workspaceId, email: input.email },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A contact with this email exists' });
      }
      const contact = await ctx.tenantDb.contact.create({
        data: {
          id: newId('contact'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          email: input.email,
          phone: input.phone,
          firstName: input.firstName,
          lastName: input.lastName,
          attributes: input.attributes,
          source: 'manual',
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'contact.created',
          targetType: 'contact',
          targetId: contact.id,
        },
      });
      await emitWebhookEvent(ctx, 'contact.created', {
        id: contact.id,
        email: contact.email,
        workspaceId: contact.workspaceId,
      });
      await pushContactToSalesforce(ctx, contact);
      return contact;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        firstName: z.string().trim().max(80).nullish(),
        lastName: z.string().trim().max(80).nullish(),
        attributes: attributesSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const contact = await ctx.tenantDb.contact.update({
        where: { id: input.id },
        data: {
          firstName: input.firstName ?? undefined,
          lastName: input.lastName ?? undefined,
          attributes: input.attributes,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: contact.workspaceId,
          actorId: ctx.session.user.id,
          action: 'contact.updated',
          targetType: 'contact',
          targetId: contact.id,
        },
      });
      return contact;
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      // Hard delete by design: GDPR erasure, cascades list memberships.
      const contact = await ctx.tenantDb.contact.delete({ where: { id: input.id } });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: contact.workspaceId,
          actorId: ctx.session.user.id,
          action: 'contact.deleted',
          targetType: 'contact',
          targetId: contact.id,
        },
      });
      return { id: contact.id };
    }),

  import: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      await assertWorkspace(ctx.tenantDb, input.workspaceId);
      const { valid, invalid, duplicates, source, suppressed } = normalizeContactRows(input.rows);
      const result = await ctx.tenantDb.contact.createMany({
        data: valid.map((row) => ({
          id: newId('contact'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          // Honor the vendor's unsubscribe state on import — suppressed
          // contacts are never mailed by any sender.
          status: row.status ?? 'ACTIVE',
          attributes: row.attributes,
          source: `${source}-import`,
        })),
        skipDuplicates: true,
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'contacts.imported',
          metadata: {
            received: input.rows.length,
            created: result.count,
            invalid,
            duplicates,
            source,
            suppressed,
          },
        },
      });
      return {
        created: result.count,
        skippedExisting: valid.length - result.count,
        invalid,
        duplicates,
        source,
        suppressed,
      };
    }),

  exportCsv: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        search: z.string().trim().max(120).optional(),
        listId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Bulk PII egress — held to the same role bar as bulk imports.
      requireRole(ctx.memberRole, 'editor');
      await assertWorkspace(ctx.tenantDb, input.workspaceId);
      const contacts = await ctx.tenantDb.contact.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.listId ? { listMembers: { some: { listId: input.listId } } } : {}),
          ...(input.search
            ? {
                OR: [
                  { email: { contains: input.search, mode: 'insensitive' as const } },
                  { firstName: { contains: input.search, mode: 'insensitive' as const } },
                  { lastName: { contains: input.search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: { id: 'desc' },
        take: EXPORT_CAP + 1,
      });
      const truncated = contacts.length > EXPORT_CAP;
      if (truncated) contacts.pop();
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'contacts.exported',
          metadata: {
            count: contacts.length,
            truncated,
            listId: input.listId ?? null,
            filtered: Boolean(input.search),
          },
        },
      });
      return { csv: contactsToCsv(contacts), count: contacts.length, truncated };
    }),

  dataExport: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const contact = await ctx.tenantDb.contact.findUnique({
        where: { id: input.id },
        include: {
          listMembers: { include: { list: { select: { name: true } } } },
          emailSends: { orderBy: { createdAt: 'desc' }, take: 200 },
          journeyRuns: { orderBy: { startedAt: 'desc' }, take: 200 },
          tasks: { orderBy: { createdAt: 'desc' }, take: 200 },
          meetings: { orderBy: { createdAt: 'desc' }, take: 200 },
          pushSubscriptions: true,
        },
      });
      if (!contact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      }
      // The behavioral timeline lives in ClickHouse; the bundle degrades to
      // the relational record when the analytics store is offline.
      const events = await (async (): Promise<unknown[] | null> => {
        try {
          const result = await getClickHouse().query({
            query: `SELECT type, event, properties, context, timestamp
                    FROM events
                    WHERE workspace_id = {workspaceId: String} AND user_id = {email: String}
                    ORDER BY timestamp DESC
                    LIMIT 500`,
            query_params: { workspaceId: contact.workspaceId, email: contact.email },
            format: 'JSONEachRow',
          });
          return (await result.json()) as unknown[];
        } catch {
          return null;
        }
      })();
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: contact.workspaceId,
          actorId: ctx.session.user.id,
          action: 'contact.data_exported',
          targetType: 'contact',
          targetId: contact.id,
        },
      });
      return { contact, events, eventsUnavailable: events === null };
    }),
});
