import { newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requireRole, router } from '../init';

export const contactListRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.contactList.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: true } } },
    }),
  ),

  create: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const existing = await ctx.tenantDb.contactList.findFirst({
        where: { workspaceId: input.workspaceId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A list with this name exists' });
      }
      const list = await ctx.tenantDb.contactList.create({
        data: {
          id: newId('list'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'contact_list.created',
          targetType: 'contact_list',
          targetId: list.id,
        },
      });
      return list;
    }),

  addMembers: orgProcedure
    .input(
      z.object({ listId: z.string().min(1), contactIds: z.array(z.string()).min(1).max(1000) }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const result = await ctx.tenantDb.contactListMember.createMany({
        data: input.contactIds.map((contactId) => ({
          listId: input.listId,
          contactId,
          organizationId: ctx.organizationId,
        })),
        skipDuplicates: true,
      });
      return { added: result.count };
    }),

  removeMember: orgProcedure
    .input(z.object({ listId: z.string().min(1), contactId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      await ctx.tenantDb.contactListMember.delete({
        where: { listId_contactId: { listId: input.listId, contactId: input.contactId } },
      });
      return { removed: true };
    }),
});
