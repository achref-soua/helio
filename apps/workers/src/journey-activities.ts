import {
  clickRedirectUrl,
  type EmailDocument,
  mintUnsubscribeToken,
  newId,
  openPixelUrl,
  type SegmentCondition,
  type SegmentRule,
  unsubscribeUrl,
} from '@helio/core';
import { compileSegmentRule, type PrismaClient } from '@helio/db';
import { renderEmail } from '@helio/emails';

import type { ActivityConfig } from './activities';
import type { EmailProvider } from './email-provider';

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
