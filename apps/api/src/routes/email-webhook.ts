import { timingSafeEqual } from 'node:crypto';

import { newId } from '@helio/core';
import { activeContactsByEmailForWebhook, forTenant, type PrismaClient } from '@helio/db';
import { Hono } from 'hono';

import type { GatewayDeps, GatewayEnv } from '../types';

export type SuppressionReason = 'BOUNCED' | 'COMPLAINED';

export interface EmailSuppression {
  reason: SuppressionReason;
  emails: string[];
  /** Provider-reported classification, recorded on the audit trail. */
  detail: string;
}

/**
 * Postmark bounce/complaint webhook body → suppression, when warranted.
 * Only address-fatal bounce types suppress; transient ones are retried by
 * the provider and say nothing about the address itself.
 */
export function postmarkSuppression(body: Record<string, unknown>): EmailSuppression | null {
  const email = typeof body.Email === 'string' ? body.Email : '';
  if (!email) return null;
  if (body.RecordType === 'Bounce') {
    const type = typeof body.Type === 'string' ? body.Type : 'unknown';
    if (type !== 'HardBounce' && type !== 'BadEmailAddress') return null;
    return { reason: 'BOUNCED', emails: [email], detail: type };
  }
  if (body.RecordType === 'SpamComplaint') {
    return { reason: 'COMPLAINED', emails: [email], detail: 'SpamComplaint' };
  }
  return null;
}

function recipientEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry as { emailAddress?: unknown }).emailAddress)
    .filter((email): email is string => typeof email === 'string' && email.length > 0);
}

/** SES notification (SNS envelope already unwrapped) → suppression. */
export function sesSuppression(message: Record<string, unknown>): EmailSuppression | null {
  if (message.notificationType === 'Bounce') {
    const bounce = (message.bounce ?? {}) as Record<string, unknown>;
    // Transient ("soft") bounces are SES's to retry, not ours to suppress.
    if (bounce.bounceType !== 'Permanent') return null;
    const emails = recipientEmails(bounce.bouncedRecipients);
    return emails.length > 0 ? { reason: 'BOUNCED', emails, detail: 'Permanent' } : null;
  }
  if (message.notificationType === 'Complaint') {
    const complaint = (message.complaint ?? {}) as Record<string, unknown>;
    const emails = recipientEmails(complaint.complainedRecipients);
    const detail =
      typeof complaint.complaintFeedbackType === 'string'
        ? complaint.complaintFeedbackType
        : 'complaint';
    return emails.length > 0 ? { reason: 'COMPLAINED', emails, detail } : null;
  }
  return null;
}

/**
 * Flip every active contact holding a suppressed address, in every
 * workspace. A hard bounce or complaint is a property of the address and
 * of the deployment's sending reputation, not of one tenant — every send
 * path already honors contact status, so this is the suppression list.
 */
export async function applyEmailSuppression(
  prisma: PrismaClient,
  suppression: EmailSuppression,
  provider: string,
): Promise<{ suppressed: number }> {
  let suppressed = 0;
  for (const raw of suppression.emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    const contacts = await activeContactsByEmailForWebhook(prisma, email);
    for (const contact of contacts) {
      const tenantDb = forTenant(prisma, contact.organizationId);
      await tenantDb.contact.update({
        where: { id: contact.id },
        data: { status: suppression.reason },
      });
      await tenantDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: contact.organizationId,
          workspaceId: contact.workspaceId,
          action: suppression.reason === 'BOUNCED' ? 'contact.bounced' : 'contact.complained',
          targetType: 'contact',
          targetId: contact.id,
          metadata: { via: 'email_webhook', provider, detail: suppression.detail },
        },
      });
      suppressed += 1;
    }
  }
  return { suppressed };
}

function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** SNS will only ever hand us an https URL on an AWS host; anything else
 * in a SubscribeURL is a forged envelope angling for SSRF. */
function isSnsSubscribeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.amazonaws.com');
  } catch {
    return false;
  }
}

/**
 * Bounce/complaint webhooks. Authenticated by a shared token carried on
 * the webhook URL (`?token=`) — SNS cannot send custom headers — so the
 * endpoint mounts outside /v1 like the other provider webhooks. Disabled
 * (404) until EMAIL_WEBHOOK_TOKEN is configured.
 */
export function emailWebhookRoutes(deps: GatewayDeps) {
  const app = new Hono<GatewayEnv>();

  app.post('/webhooks/email/:provider', async (c) => {
    if (!deps.emailWebhook) return c.json({ error: 'email_webhooks_disabled' }, 404);
    if (!tokensMatch(c.req.query('token') ?? '', deps.emailWebhook.token)) {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const provider = c.req.param('provider');
    if (provider !== 'postmark' && provider !== 'ses') {
      return c.json({ error: 'unknown_provider' }, 404);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const body = (payload ?? {}) as Record<string, unknown>;

    if (provider === 'postmark') {
      const suppression = postmarkSuppression(body);
      const result = suppression
        ? await applyEmailSuppression(deps.prisma, suppression, provider)
        : { suppressed: 0 };
      return c.json({ received: true, ...result }, 200);
    }

    // SES delivers through SNS: confirm subscriptions, unwrap notifications.
    if (body.Type === 'SubscriptionConfirmation') {
      const url = typeof body.SubscribeURL === 'string' ? body.SubscribeURL : '';
      if (!isSnsSubscribeUrl(url)) return c.json({ error: 'invalid_subscribe_url' }, 400);
      await deps.emailWebhook.fetch(url);
      return c.json({ received: true, confirmed: true }, 200);
    }
    let message: Record<string, unknown> = body;
    if (typeof body.Message === 'string') {
      try {
        message = JSON.parse(body.Message) as Record<string, unknown>;
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
    }
    const suppression = sesSuppression(message);
    const result = suppression
      ? await applyEmailSuppression(deps.prisma, suppression, 'ses')
      : { suppressed: 0 };
    return c.json({ received: true, ...result }, 200);
  });

  return app;
}
