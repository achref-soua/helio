import {
  endpointsForEvent,
  newId,
  SENDS_TASK_QUEUE,
  WEBHOOK_DELIVERY_WORKFLOW,
  type WebhookEvent,
} from '@helio/core';
import type { TenantClient } from '@helio/db';
import { trace } from '@opentelemetry/api';

import { getTemporalClient } from './temporal';

interface EmitContext {
  tenantDb: TenantClient;
  organizationId: string;
}

/**
 * Fan one domain event out to the org's subscribed webhook endpoints, starting
 * a durable Temporal delivery workflow per endpoint. Best-effort by design: no
 * matching endpoint is a no-op, and an unreachable Temporal (e.g. the core
 * compose profile) is recorded on the active trace span but never fails the
 * originating mutation — unlike campaign sends, webhooks degrade quietly.
 */
export async function emitWebhookEvent(
  ctx: EmitContext,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const endpoints = await ctx.tenantDb.webhookEndpoint.findMany({
      where: { enabled: true },
      select: { id: true, url: true, secret: true, enabled: true, events: true },
    });
    const targets = endpointsForEvent(endpoints, event);
    if (targets.length === 0) return;

    const client = await getTemporalClient();
    const occurredAt = new Date().toISOString();
    await Promise.all(
      targets.map((endpoint) => {
        const eventId = newId('evt');
        return client.workflow.start(WEBHOOK_DELIVERY_WORKFLOW, {
          taskQueue: SENDS_TASK_QUEUE,
          workflowId: `whk-${endpoint.id}-${eventId}`,
          args: [
            {
              endpointId: endpoint.id,
              url: endpoint.url,
              secret: endpoint.secret,
              eventId,
              eventType: event,
              occurredAt,
              data,
            },
          ],
        });
      }),
    );
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(error instanceof Error ? error : new Error(String(error)));
  }
}
