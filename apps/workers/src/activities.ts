import type { ClickHouseClient } from '@clickhouse/client';
import type { SegmentRule } from '@helio/core';
import {
  buildEventConditionQuery,
  clickRedirectUrl,
  type EmailDocument,
  eventConditionKey,
  extractEventConditions,
  mintUnsubscribeToken,
  newId,
  openPixelUrl,
  unsubscribeUrl,
} from '@helio/core';
import { compileSegmentRule, type EventConditionSets, type PrismaClient } from '@helio/db';
import { renderEmail } from '@helio/emails';
import { Context } from '@temporalio/activity';

import type { EmailProvider } from './email-provider';

export interface ActivityConfig {
  mailFrom: string;
  appUrl: string;
  trackingUrl: string;
  trackingSecret: string;
  unsubscribeSecret: string;
  /** Optional HMAC key for journey webhook payload signatures. */
  webhookSecret?: string;
}

export interface SendBatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

export interface CampaignContext {
  organizationId: string;
  workspaceId: string;
}

/**
 * Campaign activities. All database access uses the admin client — the
 * workflow carries only ids, and every query re-scopes by the campaign's
 * own organization/workspace (ADR-0011).
 */
export function createActivities(
  prisma: PrismaClient,
  provider: EmailProvider,
  config: ActivityConfig,
  clickhouse?: ClickHouseClient,
) {
  /** Behavioral audiences need the event store; fail actionably without it. */
  async function resolveEventSets(
    rule: SegmentRule,
    workspaceId: string,
  ): Promise<EventConditionSets> {
    const conditions = extractEventConditions(rule);
    const sets: EventConditionSets = new Map();
    if (conditions.length === 0) return sets;
    if (!clickhouse) {
      throw new Error(
        'campaign audience uses behavioral conditions but ClickHouse is not configured',
      );
    }
    for (const condition of conditions) {
      const { query, params, mode } = buildEventConditionQuery(condition);
      const result = await clickhouse.query({
        query,
        query_params: { workspaceId, ...params },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<{ user_id: string }>;
      sets.set(eventConditionKey(condition), { mode, emails: rows.map((row) => row.user_id) });
    }
    return sets;
  }

  return {
    /** Move DRAFT → SENDING and hand the workflow its tenancy scope. */
    async startCampaign(campaignId: string): Promise<CampaignContext> {
      const campaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'SENDING', error: null },
        select: { organizationId: true, workspaceId: true },
      });
      return campaign;
    },

    /**
     * One page of ACTIVE recipient ids (cursor-based). Suppression is
     * enforced here: anything not ACTIVE never enters the pipeline.
     */
    async listRecipients(
      campaignId: string,
      cursor: string | null,
      limit: number,
    ): Promise<{ contactIds: string[]; nextCursor: string | null }> {
      const campaign = await prisma.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: { workspaceId: true, segmentId: true, listId: true, segment: true },
      });
      const audience = campaign.segmentId
        ? compileSegmentRule(
            campaign.segment!.rule as unknown as SegmentRule,
            await resolveEventSets(
              campaign.segment!.rule as unknown as SegmentRule,
              campaign.workspaceId,
            ),
          )
        : { listMembers: { some: { listId: campaign.listId ?? '' } } };

      const contacts = await prisma.contact.findMany({
        where: {
          AND: [{ workspaceId: campaign.workspaceId, status: 'ACTIVE' }, audience],
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      });
      // The +1th row only signals another page; the cursor must be the
      // last row we keep (skip:1 then resumes at the row we popped).
      const hasMore = contacts.length > limit;
      if (hasMore) contacts.pop();
      const nextCursor = hasMore ? contacts.at(-1)!.id : null;
      return { contactIds: contacts.map((contact) => contact.id), nextCursor };
    },

    /**
     * Render + deliver one batch. Idempotent under Temporal retries:
     * a unique (campaignId, contactId) send row is claimed before
     * delivery, SENT rows are never re-sent, and rows left QUEUED by a
     * crash are retried (at-least-once within the batch — ADR-0011).
     */
    async sendToContacts(campaignId: string, contactIds: string[]): Promise<SendBatchResult> {
      const campaign = await prisma.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        include: { template: true },
      });
      const result: SendBatchResult = { sent: 0, failed: 0, skipped: 0 };

      for (const contactId of contactIds) {
        Context.current().heartbeat(contactId);
        const contact = await prisma.contact.findUnique({ where: { id: contactId } });
        if (!contact || contact.status !== 'ACTIVE') {
          result.skipped += 1;
          continue;
        }

        // Claim or recover the send row for this contact.
        const existing = await prisma.emailSend.findUnique({
          where: { campaignId_contactId: { campaignId, contactId } },
        });
        if (existing && existing.status === 'SENT') {
          result.skipped += 1;
          continue;
        }
        // A/B: assign the variant at claim time; retries reuse the row,
        // so a contact can never receive both subjects.
        const variant = campaign.subjectB ? (Math.random() < 0.5 ? 'a' : 'b') : null;
        const send =
          existing ??
          (await prisma.emailSend.create({
            data: {
              id: newId('snd'),
              organizationId: campaign.organizationId,
              workspaceId: campaign.workspaceId,
              contactId,
              campaignId,
              email: contact.email,
              subject: variant === 'b' ? campaign.subjectB! : campaign.template.subject,
              variant,
            },
          }));

        try {
          const token = await mintUnsubscribeToken(config.unsubscribeSecret, contact.id);
          const unsubscribe = unsubscribeUrl(config.appUrl, token);
          const rendered = await renderEmail({
            document: campaign.template.document as unknown as EmailDocument,
            subject: send.subject,
            contact: {
              email: contact.email,
              firstName: contact.firstName,
              lastName: contact.lastName,
              attributes: (contact.attributes ?? {}) as Record<string, unknown>,
            },
            unsubscribeUrl: unsubscribe,
            pixelUrl: openPixelUrl(config.trackingUrl, send.id),
            wrapLink: (url) =>
              clickRedirectUrl(config.trackingUrl, config.trackingSecret, send.id, url),
          });

          await provider.send({
            from: config.mailFrom,
            to: contact.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            headers: {
              // RFC 8058: providers POST to this URL with no page render.
              'List-Unsubscribe': `<${unsubscribe}/one-click>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          });
          await prisma.emailSend.update({
            where: { id: send.id },
            data: { status: 'SENT', sentAt: new Date(), error: null },
          });
          result.sent += 1;
        } catch (error) {
          await prisma.emailSend.update({
            where: { id: send.id },
            data: { status: 'FAILED', error: error instanceof Error ? error.message : 'unknown' },
          });
          result.failed += 1;
        }
      }
      return result;
    },

    /** Terminal bookkeeping. */
    async completeCampaign(campaignId: string, failedSends: number): Promise<void> {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          error: failedSends > 0 ? `${failedSends} sends failed` : null,
        },
      });
    },

    async failCampaign(campaignId: string, message: string): Promise<void> {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'FAILED', error: message.slice(0, 500) },
      });
    },
  };
}

export type CampaignActivities = ReturnType<typeof createActivities>;
