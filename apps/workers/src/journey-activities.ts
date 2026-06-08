import { createHmac } from 'node:crypto';

import {
  clickRedirectUrl,
  type EmailDocument,
  type FrequencyCap,
  mintUnsubscribeToken,
  newId,
  openPixelUrl,
  type QuietHours,
  quietHoursDelayMs,
  type SegmentCondition,
  type SegmentRule,
  sendTimeDelayMs,
  unsubscribeUrl,
} from '@helio/core';
import { compileSegmentRule, type Prisma, type PrismaClient } from '@helio/db';
import { renderEmail } from '@helio/emails';

import type { ActivityConfig } from './activities';
import type { EmailProvider } from './email-provider';
import type { PushProvider } from './push-provider';

export interface LoadedJourney {
  organizationId: string;
  workspaceId: string;
  /** Already validated at save time; the workflow re-parses defensively. */
  definition: unknown;
}

/**
 * Journey activities (ADR-0012). One contact per workflow, so sends are
 * single-recipient; suppression is re-checked at every send.
 */
export function createJourneyActivities(
  prisma: PrismaClient,
  provider: EmailProvider,
  config: ActivityConfig,
  pushProvider?: PushProvider,
) {
  return {
    async loadJourney(journeyId: string): Promise<LoadedJourney> {
      const journey = await prisma.journey.findUniqueOrThrow({
        where: { id: journeyId },
        select: { organizationId: true, workspaceId: true, definition: true },
      });
      return journey;
    },

    /** Render + deliver one journey email. Skips suppressed contacts. */
    async sendJourneyEmail(
      journeyId: string,
      contactId: string,
      templateId: string,
    ): Promise<{ sent: boolean }> {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact || contact.status !== 'ACTIVE') return { sent: false };
      const template = await prisma.emailTemplate.findUniqueOrThrow({
        where: { id: templateId },
      });

      const send = await prisma.emailSend.create({
        data: {
          id: newId('snd'),
          organizationId: contact.organizationId,
          workspaceId: contact.workspaceId,
          contactId,
          email: contact.email,
          subject: template.subject,
        },
      });
      try {
        const token = await mintUnsubscribeToken(config.unsubscribeSecret, contact.id);
        const unsubscribe = unsubscribeUrl(config.appUrl, token);
        const rendered = await renderEmail({
          document: template.document as unknown as EmailDocument,
          subject: template.subject,
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
            'List-Unsubscribe': `<${unsubscribe}/one-click>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        await prisma.emailSend.update({
          where: { id: send.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        return { sent: true };
      } catch (error) {
        await prisma.emailSend.update({
          where: { id: send.id },
          data: { status: 'FAILED', error: error instanceof Error ? error.message : 'unknown' },
        });
        throw error;
      }
    },

    /** Branch decision: does the contact match the condition right now? */
    async evaluateCondition(contactId: string, condition: SegmentCondition): Promise<boolean> {
      const rule: SegmentRule = { kind: 'group', op: 'and', children: [condition] } as SegmentRule;
      const count = await prisma.contact.count({
        where: { AND: [{ id: contactId }, compileSegmentRule(rule)] },
      });
      return count > 0;
    },

    /**
     * Send gate: -1 to skip (frequency cap hit), otherwise milliseconds
     * to defer for quiet hours (0 = clear to send). Counts SENT mail to
     * the contact across all sources — campaign blasts included.
     */
    async sendGate(
      contactId: string,
      quietHours: QuietHours | null,
      frequencyCap: FrequencyCap | null,
      optimizeSendTime = false,
    ): Promise<number> {
      if (frequencyCap) {
        const since = new Date(Date.now() - frequencyCap.perDays * 86_400_000);
        const recent = await prisma.emailSend.count({
          where: { contactId, status: 'SENT', sentAt: { gte: since } },
        });
        if (recent >= frequencyCap.maxEmails) return -1;
      }
      const now = new Date();
      // First defer to the contact's best engagement hour (if enabled and
      // known), then apply quiet hours at that future instant — so the two
      // never collide and a send always lands in an allowed, optimal slot.
      let stoDelay = 0;
      if (optimizeSendTime) {
        const contact = await prisma.contact.findUnique({
          where: { id: contactId },
          select: { bestSendHour: true },
        });
        if (contact?.bestSendHour != null) {
          stoDelay = sendTimeDelayMs(contact.bestSendHour, now);
        }
      }
      const candidate = new Date(now.getTime() + stoDelay);
      const quietDelay = quietHours ? quietHoursDelayMs(quietHours, candidate) : 0;
      return stoDelay + quietDelay;
    },

    /** Merge one trait into the contact's attributes JSON. */
    async applyTrait(contactId: string, key: string, value: string): Promise<void> {
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { attributes: true },
      });
      if (!contact) return;
      const attributes = { ...(contact.attributes as Record<string, unknown>), [key]: value };
      await prisma.contact.update({
        where: { id: contactId },
        data: { attributes: attributes as Prisma.InputJsonValue },
      });
    },

    /**
     * Notify an external system. The payload is HMAC-signed when a
     * signing secret is configured; non-2xx responses throw so the
     * Temporal retry policy applies.
     */
    async callWebhook(
      url: string,
      payload: { journeyId: string; contactId: string; email: string },
    ): Promise<void> {
      const body = JSON.stringify({ ...payload, sentAt: new Date().toISOString() });
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (config.webhookSecret) {
        headers['x-helio-signature'] = createHmac('sha256', config.webhookSecret)
          .update(body)
          .digest('hex');
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`webhook ${url} answered ${response.status}`);
      }
    },

    /** Contact email for webhook payloads (kept tiny on purpose). */
    async contactEmail(contactId: string): Promise<string> {
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { email: true },
      });
      return contact?.email ?? '';
    },

    /**
     * Push every live subscription for a contact. Dead endpoints
     * (404/410) are pruned; returns how many were delivered.
     */
    async sendJourneyPush(
      contactId: string,
      notification: { title: string; body: string; url?: string },
    ): Promise<{ sent: number }> {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact || contact.status !== 'ACTIVE' || !pushProvider) return { sent: 0 };
      const subscriptions = await prisma.pushSubscription.findMany({ where: { contactId } });
      let sent = 0;
      for (const subscription of subscriptions) {
        const result = await pushProvider.send(
          { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
          notification,
        );
        if (result === 'sent') sent += 1;
        else if (result === 'gone') {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } });
        }
      }
      return { sent };
    },

    async completeRun(runId: string): Promise<void> {
      await prisma.journeyRun.update({
        where: { id: runId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    },

    async failRun(runId: string, message: string): Promise<void> {
      await prisma.journeyRun.update({
        where: { id: runId },
        data: { status: 'FAILED', error: message.slice(0, 500), completedAt: new Date() },
      });
    },
  };
}

export type JourneyActivities = ReturnType<typeof createJourneyActivities>;
