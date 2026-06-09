import { isHexColor, newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requireRole, router } from '../init';

const hexColorSchema = z.string().trim().refine(isHexColor, 'Must be a #rgb or #rrggbb hex color');

const logoUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), 'URL must be http(s)');

/**
 * White-label branding for the org: a display name, accent color, and logo,
 * stored on the organization row and reached through the tenant client (the
 * RLS policy scopes it to `id = app.org_id`). Any member can read it to render
 * the shell; only admins can change it.
 */
export const brandingRouter = router({
  get: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.tenantDb.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true, brandName: true, brandColor: true, logo: true },
    });
    if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
    return org;
  }),

  update: orgProcedure
    .input(
      z.object({
        brandName: z.string().trim().max(60).nullable().optional(),
        brandColor: hexColorSchema.nullable().optional(),
        logo: logoUrlSchema.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'admin');
      await ctx.tenantDb.organization.update({
        where: { id: ctx.organizationId },
        data: {
          ...(input.brandName !== undefined ? { brandName: input.brandName || null } : {}),
          ...(input.brandColor !== undefined ? { brandColor: input.brandColor } : {}),
          ...(input.logo !== undefined ? { logo: input.logo } : {}),
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          actorId: ctx.session.user.id,
          action: 'branding.updated',
          targetType: 'organization',
          targetId: ctx.organizationId,
        },
      });
      return { ok: true };
    }),
});
