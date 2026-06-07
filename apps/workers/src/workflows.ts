import { ApplicationFailure, proxyActivities } from '@temporalio/workflow';

import type { CampaignActivities } from './activities';

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
  try {
    await activities.startCampaign(input.campaignId);

    let cursor: string | null = null;
    do {
      const page: { contactIds: string[]; nextCursor: string | null } =
        await activities.listRecipients(input.campaignId, cursor, BATCH_SIZE);
      if (page.contactIds.length > 0) {
        const result = await sendActivities.sendToContacts(input.campaignId, page.contactIds);
        totals.sent += result.sent;
        totals.failed += result.failed;
        totals.skipped += result.skipped;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);

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
