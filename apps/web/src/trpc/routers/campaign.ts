import { CAMPAIGN_SEND_WORKFLOW, newId, SENDS_TASK_QUEUE } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getTemporalClient } from '@/lib/temporal';

import { orgProcedure, requireRole, router } from '../init';

export const campaignRouter = router({
  list: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const campaigns = await ctx.tenantDb.campaign.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'desc' },
        include: {
          template: { select: { name: true, subject: true } },
          segment: { select: { name: true } },
          list: { select: { name: true } },
        },
      });
      const counts = await ctx.tenantDb.emailSend.groupBy({
        by: ['campaignId', 'status'],
        where: { workspaceId: input.workspaceId, campaignId: { not: null } },
        _count: true,
      });
      const byCampaign = new Map<string, Record<string, number>>();
      for (const row of counts) {
        if (!row.campaignId) continue;
        const entry = byCampaign.get(row.campaignId) ?? {};
        entry[row.status] = row._count;
        byCampaign.set(row.campaignId, entry);
      }
      return campaigns.map((campaign) => ({
        ...campaign,
        sendCounts: byCampaign.get(campaign.id) ?? {},
      }));
    }),

  create: orgProcedure
    .input(
      z
        .object({
          workspaceId: z.string().min(1),
          name: z.string().trim().min(1).max(80),
          templateId: z.string().min(1),
          segmentId: z.string().min(1).optional(),
          listId: z.string().min(1).optional(),
        })
        .refine((value) => !!value.segmentId !== !!value.listId, {
          message: 'choose exactly one audience: a segment or a list',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const existing = await ctx.tenantDb.campaign.findFirst({
        where: { workspaceId: input.workspaceId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A campaign with this name exists' });
      }
      const campaign = await ctx.tenantDb.campaign.create({
        data: {
          id: newId('cmp'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          templateId: input.templateId,
          segmentId: input.segmentId,
          listId: input.listId,
        },
      });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: input.workspaceId,
          actorId: ctx.session.user.id,
          action: 'campaign.created',
          targetType: 'campaign',
          targetId: campaign.id,
        },
      });
      return campaign;
    }),

  /** Launch the durable send workflow (idempotent per campaign). */
  send: orgProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.memberRole, 'editor');
    const campaign = await ctx.tenantDb.campaign.findUnique({ where: { id: input.id } });
    if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
    if (campaign.status !== 'DRAFT' && campaign.status !== 'FAILED') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Campaign is already sending or sent' });
    }

    let client;
    try {
      client = await getTemporalClient();
    } catch {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Temporal is unreachable — start the full stack (task up:full) and the worker',
      });
    }
    // workflowId = campaign id ⇒ relaunches dedupe server-side.
    await client.workflow.start(CAMPAIGN_SEND_WORKFLOW, {
      taskQueue: SENDS_TASK_QUEUE,
      workflowId: `campaign-send-${campaign.id}`,
      args: [{ campaignId: campaign.id }],
    });

    await ctx.tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId: ctx.organizationId,
        workspaceId: campaign.workspaceId,
        actorId: ctx.session.user.id,
        action: 'campaign.send_started',
        targetType: 'campaign',
        targetId: campaign.id,
      },
    });
    return { started: true };
  }),

  delete: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'editor');
      const campaign = await ctx.tenantDb.campaign.findUnique({ where: { id: input.id } });
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
      if (campaign.status !== 'DRAFT') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Only draft campaigns can be deleted' });
      }
      await ctx.tenantDb.campaign.delete({ where: { id: campaign.id } });
      await ctx.tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: ctx.organizationId,
          workspaceId: campaign.workspaceId,
          actorId: ctx.session.user.id,
          action: 'campaign.deleted',
          targetType: 'campaign',
          targetId: campaign.id,
        },
      });
      return { id: campaign.id };
    }),
});
