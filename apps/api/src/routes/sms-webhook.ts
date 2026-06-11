import { timingSafeEqual } from 'node:crypto';

import { newId } from '@helio/core';
import { activeContactsByPhoneForWebhook, forTenant } from '@helio/db';
import { Hono } from 'hono';

import type { GatewayDeps, GatewayEnv } from '../types';

/** Twilio statuses that mean the message definitively did not arrive. */
const FAILURE_STATUSES = new Set(['failed', 'undelivered']);

function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Twilio delivery-status callback. Authenticated by a shared token on the
 * URL (configure the StatusCallback as
 * `https://<gateway>/webhooks/sms/twilio?token=…`); disabled (404) until
 * SMS_WEBHOOK_TOKEN is set. Failed deliveries raise an operational alert
 * for every organization holding the number — phone numbers, like email
 * addresses, are resolved through a SECURITY DEFINER lookup (ADR-0017).
 */
export function smsWebhookRoutes(deps: GatewayDeps) {
  const app = new Hono<GatewayEnv>();

  app.post('/webhooks/sms/twilio', async (c) => {
    if (!deps.smsWebhook) return c.json({ error: 'sms_webhooks_disabled' }, 404);
    if (!tokensMatch(c.req.query('token') ?? '', deps.smsWebhook.token)) {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const form = await c.req.parseBody();
    const status = String(form.MessageStatus ?? '').toLowerCase();
    if (!FAILURE_STATUSES.has(status)) return c.body(null, 204);

    const to = String(form.To ?? '');
    const sid = String(form.MessageSid ?? '');
    const errorCode = String(form.ErrorCode ?? '');
    if (!to || !sid) return c.body(null, 204);

    const contacts = await activeContactsByPhoneForWebhook(deps.prisma, to);
    const alerted = new Set<string>();
    for (const contact of contacts) {
      if (alerted.has(contact.organizationId)) continue;
      alerted.add(contact.organizationId);

      const tenantDb = forTenant(deps.prisma, contact.organizationId);
      // Twilio retries callbacks; an unread alert for the same message is
      // enough.
      const existing = await tenantDb.systemAlert.findFirst({
        where: {
          kind: 'sms_delivery_failed',
          readAt: null,
          context: { path: ['messageSid'], equals: sid },
        },
        select: { id: true },
      });
      if (existing) continue;
      await tenantDb.systemAlert.create({
        data: {
          id: newId('alert'),
          organizationId: contact.organizationId,
          kind: 'sms_delivery_failed',
          message: `An SMS to ${to} was ${status}${errorCode && errorCode !== 'undefined' ? ` (Twilio error ${errorCode})` : ''}`,
          context: { messageSid: sid, to, status, errorCode },
        },
      });
    }
    return c.body(null, 204);
  });

  return app;
}
