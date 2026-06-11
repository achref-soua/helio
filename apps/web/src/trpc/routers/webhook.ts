import { generateWebhookSecret, newId, signWebhookPayload, webhookEventSchema } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, requirePermission, router } from '../init';

/** A reachable http(s) endpoint, capped to keep stored rows sane. */
const webhookUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), 'URL must be http(s)');

const eventsSchema = z.array(webhookEventSchema).min(1).max(20);

/**
 * Outbound webhook endpoints. Org-scoped like API keys and reached through the
 * tenant client, so a row is created, listed, and removed entirely within the
 * caller's org. The signing secret is returned by `create` exactly once;
 * deliveries are signed with it (see @helio/core `signWebhookPayload`).
 */
export const webhookRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'settings:webhooks');
    return ctx.tenantDb.webhookEndpoint.findMany({
      select: {
        id: true,
        url: true,
        description: true,
        events: true,
        enabled: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  create: orgProcedure
    .input(
      z.object({
        url: webhookUrlSchema,
        description: z.string().trim().max(200).optional(),
        events: eventsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:webhooks');
      const secret = generateWebhookSecret();
      const endpoint = await ctx.tenantDb.webhookEndpoint.create({
        data: {
          id: newId('whe'),
          organizationId: ctx.organizationId,
          url: input.url,
          description: input.description,
          secret,
          events: [...new Set(input.events)],
        },
      });
      // The plaintext secret is shown to the operator exactly once.
      return { id: endpoint.id, secret };
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string().min(1),
        url: webhookUrlSchema.optional(),
        description: z.string().trim().max(200).nullable().optional(),
        events: eventsSchema.optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:webhooks');
      const { id, ...rest } = input;
      const { count } = await ctx.tenantDb.webhookEndpoint.updateMany({
        where: { id },
        data: {
          url: rest.url,
          enabled: rest.enabled,
          ...(rest.events ? { events: [...new Set(rest.events)] } : {}),
          ...(rest.description !== undefined ? { description: rest.description } : {}),
        },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:webhooks');
      const { count } = await ctx.tenantDb.webhookEndpoint.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  // Synchronous "ping" delivery so the operator gets immediate feedback that
  // the endpoint is reachable and verifies signatures — works without Temporal.
  sendTest: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:webhooks');
      const endpoint = await ctx.tenantDb.webhookEndpoint.findUnique({ where: { id: input.id } });
      if (!endpoint) throw new TRPCError({ code: 'NOT_FOUND' });
      const body = JSON.stringify({
        id: newId('evt'),
        type: 'ping',
        occurredAt: new Date().toISOString(),
        data: { message: 'Test delivery from Helio' },
      });
      const signature = await signWebhookPayload(endpoint.secret, body);
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Helio-Webhooks/1.0',
            'x-helio-event': 'ping',
            'x-helio-signature': signature,
          },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        return { ok: response.ok, status: response.status };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : 'request failed',
        };
      }
    }),
});
