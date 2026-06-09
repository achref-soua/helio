import { isInAbTestSample } from '@helio/core';
import { ApplicationFailure, proxyActivities, sleep } from '@temporalio/workflow';

import type { CampaignActivities } from './activities';
import type { WebhookActivities, WebhookDeliveryInput } from './webhook-activities';

export { journeyRunWorkflow } from './journey-workflows';

const activities = proxyActivities<CampaignActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5 },
});

const sendActivities = proxyActivities<CampaignActivities>({
  // Batches heartbeat per contact; generous ceiling for slow relays.
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});

export const BATCH_SIZE = 100;

export interface CampaignSendInput {
  campaignId: string;
}

export interface CampaignSendResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Durable campaign delivery: enumerate the audience page by page and
 * send batch by batch. Every step is an activity — a worker crash
 * resumes exactly where it left off, and the per-(campaign, contact)
 * send row keeps retries from double-sending (ADR-0011).
 */
export async function campaignSendWorkflow(input: CampaignSendInput): Promise<CampaignSendResult> {
  const totals: CampaignSendResult = { sent: 0, failed: 0, skipped: 0 };

  // Page the audience and send the subset matching `include`. Durable and
  // idempotent: the per-(campaign, contact) send row dedupes across the
  // test and promote passes, so a contact is sent at most once.
  async function sendAudience(
    include: (contactId: string) => boolean,
    forcedVariant?: 'a' | 'b',
  ): Promise<void> {
    let cursor: string | null = null;
    do {
      const page: { contactIds: string[]; nextCursor: string | null } =
        await activities.listRecipients(input.campaignId, cursor, BATCH_SIZE);
      const ids = page.contactIds.filter(include);
      if (ids.length > 0) {
        const result = await sendActivities.sendToContacts(input.campaignId, ids, forcedVariant);
        totals.sent += result.sent;
        totals.failed += result.failed;
        totals.skipped += result.skipped;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }

  try {
    const ctx = await activities.startCampaign(input.campaignId);

    if (ctx.abAutoWinner) {
      // 1) Send both subjects to the test slice.
      await sendAudience((id) => isInAbTestSample(id, ctx.abTestPercent));
      // 2) Wait for opens to land, durably (survives worker restarts).
      await sleep(ctx.abTestWindowSeconds * 1000);
      // 3) Decide, then send the winning subject to the holdout.
      const stats = await activities.abVariantStats(input.campaignId);
      const winner = await activities.decideAbWinner(input.campaignId, stats);
      await sendAudience((id) => !isInAbTestSample(id, ctx.abTestPercent), winner);
    } else {
      await sendAudience(() => true);
    }

    await activities.completeCampaign(input.campaignId, totals.failed);
    return totals;
  } catch (error) {
    // Temporal wraps activity errors; surface the root cause's message.
    const message = rootMessage(error) ?? 'campaign send failed';
    await activities.failCampaign(input.campaignId, message);
    throw ApplicationFailure.nonRetryable(message, 'CampaignSendFailed');
  }
}

function rootMessage(error: unknown): string | null {
  let current: unknown = error;
  while (current instanceof Error && current.cause instanceof Error) {
    current = current.cause;
  }
  return current instanceof Error ? current.message : null;
}

const webhookActivities = proxyActivities<WebhookActivities>({
  startToCloseTimeout: '30 seconds',
  // Back off across ~hours so a briefly-down endpoint still receives the
  // event; Temporal keeps the attempt durable across worker restarts.
  retry: {
    maximumAttempts: 8,
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 hour',
  },
});

/**
 * Durably deliver one webhook event to one endpoint. One workflow per
 * (event, endpoint) keeps deliveries independent and individually retried.
 */
export async function webhookDeliveryWorkflow(input: WebhookDeliveryInput): Promise<void> {
  await webhookActivities.deliverWebhookEvent(input);
}
