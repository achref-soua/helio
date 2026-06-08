import { contactEmailSchema, newId, normalizeContactRows } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requireRole, router } from '../init';

const attributesSchema = z.record(z.string(), z.string()).default({});

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
});
