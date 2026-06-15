import { dashboardLayoutSchema, normalizeDashboardLayout } from '@helio/core';
import { type Prisma } from '@helio/db';
import { z } from 'zod';

import { authDb } from '@/lib/auth';

import { orgProcedure, router } from '../init';

/**
 * The customizable dashboard. `layout` is the member's own widget order +
 * visibility (normalized against the current catalog); `metrics` are the extra
 * counts the opt-in widgets show.
 *
 * The `member` table is auth-owned (Better-Auth), outside the tenant RLS grant,
 * so layout reads/writes go through `authDb` — scoped explicitly to the
 * authenticated user's own (org, user) row, the same pattern as the `me` query.
 * `metrics` reads tenant tables and stays on the RLS-bound tenant client.
 */
export const dashboardRouter = router({
  /** The current member's normalized dashboard layout. */
  layout: orgProcedure.query(async ({ ctx }) => {
    const member = await authDb.member.findUnique({
      where: {
        organizationId_userId: {
          organizationId: ctx.organizationId,
          userId: ctx.session.user.id,
        },
      },
      select: { dashboardLayout: true },
    });
    return normalizeDashboardLayout(member?.dashboardLayout);
  }),

  /** Persist this member's layout (validated against the catalog). */
  setLayout: orgProcedure
    .input(z.object({ layout: dashboardLayoutSchema }))
    .mutation(async ({ ctx, input }) => {
      await authDb.member.update({
        where: {
          organizationId_userId: {
            organizationId: ctx.organizationId,
            userId: ctx.session.user.id,
          },
        },
        data: { dashboardLayout: input.layout as unknown as Prisma.InputJsonValue },
      });
      return { ok: true };
    }),

  /** Counts powering the opt-in widgets (tasks, audience, channels). */
  metrics: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const where = { workspaceId: input.workspaceId };
      const [tasksOpen, lists, segments, forms, landingPages, widgets, inAppMessages] =
        await Promise.all([
          ctx.tenantDb.task.count({ where: { ...where, status: 'OPEN' } }),
          ctx.tenantDb.contactList.count({ where }),
          ctx.tenantDb.segment.count({ where }),
          ctx.tenantDb.form.count({ where }),
          ctx.tenantDb.landingPage.count({ where }),
          ctx.tenantDb.widget.count({ where }),
          ctx.tenantDb.inAppMessage.count({ where }),
        ]);
      return { tasksOpen, lists, segments, forms, landingPages, widgets, inAppMessages };
    }),
});
