import { emailDocumentSchema, newId } from '@helio/core';
import type { Prisma } from '@helio/db';
import { renderEmail } from '@helio/emails';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requirePermission, router } from '../init';

/** Sample contact used by builder previews. */
const PREVIEW_CONTACT = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  attributes: { plan: 'pro', company: 'Acme' },
};

export const emailTemplateRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.emailTemplate.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, subject: true, updatedAt: true },
    }),
  ),

  get: orgProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const template = await ctx.tenantDb.emailTemplate.findUnique({ where: { id: input.id } });
    if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
    return template;
  }),

  /** Server-side render of a draft for the builder's preview pane. */
  preview: orgProcedure
    .input(z.object({ subject: z.string().max(300), document: emailDocumentSchema }))
    .query(async ({ input }) => {
      const rendered = await renderEmail({
        document: input.document,
        subject: input.subject,
        contact: PREVIEW_CONTACT,
        unsubscribeUrl: '#unsubscribe-preview',
      });
      return { subject: rendered.subject, html: rendered.html };
    }),

  create: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        subject: z.string().trim().min(1).max(300),
        document: emailDocumentSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'templates:write');
      const existing = await ctx.tenantDb.emailTemplate.findFirst({
        where: { workspaceId: input.workspaceId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A template with this name exists' });
      }
      const template = await ctx.tenantDb.emailTemplate.create({
        data: {
          id: newId('tpl'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          subject: input.subject,
          document: input.document as Prisma.InputJsonValue,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'email_template.created',
          targetType: 'email_template',
          targetId: template.id,
        },
      });
      return template;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        subject: z.string().trim().min(1).max(300).optional(),
        document: emailDocumentSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'templates:write');
      const template = await ctx.tenantDb.emailTemplate.update({
        where: { id: input.id },
        data: {
          name: input.name,
          subject: input.subject,
          ...(input.document ? { document: input.document as Prisma.InputJsonValue } : {}),
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: template.workspaceId,
          actorId: ctx.session.user.id,
          action: 'email_template.updated',
          targetType: 'email_template',
          targetId: template.id,
        },
      });
      return template;
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'templates:write');
      const template = await ctx.tenantDb.emailTemplate.delete({ where: { id: input.id } });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: template.workspaceId,
          actorId: ctx.session.user.id,
          action: 'email_template.deleted',
          targetType: 'email_template',
          targetId: template.id,
        },
      });
      return { id: template.id };
    }),
});
