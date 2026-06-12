import { availabilitySchema, isValidTimeZone, newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit';

import { orgProcedure, requirePermission, router } from '../init';

const timeZoneSchema = z.string().trim().refine(isValidTimeZone, 'Unknown timezone');

/**
 * Booking pages and their meetings. Pages and the upcoming-meeting list are
 * managed through the tenant client (RLS-scoped); the public booking page and
 * the invitee-facing booking action live outside this router (server actions
 * on the admin client, since the invitee has no session).
 */
export const schedulingRouter = router({
  getPage: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.tenantDb.bookingPage.findFirst({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'asc' },
      }),
    ),

  upsertPage: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        id: z.string().min(1).optional(),
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).nullable().optional(),
        durationMinutes: z.number().int().min(5).max(480),
        timezone: timeZoneSchema,
        availability: availabilitySchema,
        bufferMinutes: z.number().int().min(0).max(240),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'scheduling:write');
      const data = {
        title: input.title,
        description: input.description ?? null,
        durationMinutes: input.durationMinutes,
        timezone: input.timezone,
        availability: input.availability,
        bufferMinutes: input.bufferMinutes,
        enabled: input.enabled,
      };
      if (input.id) {
        const { count } = await ctx.tenantDb.bookingPage.updateMany({
          where: { id: input.id, workspaceId: input.workspaceId },
          data,
        });
        if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        await writeAudit(ctx.tenantDb, {
          organizationId: ctx.organizationId,
          actorId: ctx.session.user.id,
          action: 'booking_page.updated',
          targetType: 'booking_page',
          targetId: input.id,
        });
        return { id: input.id };
      }
      const page = await ctx.tenantDb.bookingPage.create({
        data: {
          id: newId('bpg'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          ownerId: ctx.session.user.id,
          ...data,
        },
      });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'booking_page.created',
        targetType: 'booking_page',
        targetId: page.id,
      });
      return { id: page.id };
    }),

  listMeetings: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.tenantDb.meeting.findMany({
        where: { workspaceId: input.workspaceId, status: 'BOOKED', startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        take: 50,
        select: {
          id: true,
          startAt: true,
          durationMinutes: true,
          inviteeEmail: true,
          inviteeName: true,
        },
      }),
    ),

  cancelMeeting: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'scheduling:write');
      const { count } = await ctx.tenantDb.meeting.updateMany({
        where: { id: input.id },
        data: { status: 'CANCELED' },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAudit(ctx.tenantDb, {
        organizationId: ctx.organizationId,
        actorId: ctx.session.user.id,
        action: 'meeting.canceled',
        targetType: 'meeting',
        targetId: input.id,
      });
      return { ok: true };
    }),
});
