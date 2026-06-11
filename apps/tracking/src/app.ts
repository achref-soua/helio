import { randomUUID } from 'node:crypto';

import { healthPayload, newId, verifyClickTarget } from '@helio/core';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { pino } from 'pino';

import { metricsRegistry, pixelServed, redirectsServed, trackingRejected } from './observability';
import type { ResolvedSend, TrackingDeps } from './types';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: { level: (label) => ({ level: label }) },
});

/** Smallest valid transparent GIF — inboxes request it on open. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const PIXEL_HEADERS = {
  'content-type': 'image/gif',
  'cache-control': 'no-store, no-cache, must-revalidate, private',
  pragma: 'no-cache',
  expires: '0',
} as const;

function engagementEvent(
  send: ResolvedSend,
  sendId: string,
  event: 'Email Opened' | 'Email Link Clicked',
  properties: Record<string, unknown>,
  receivedAt: Date,
) {
  return {
    message_id: newId('msg'),
    organization_id: send.organizationId,
    workspace_id: send.workspaceId,
    type: 'track' as const,
    event,
    anonymous_id: '',
    user_id: send.email,
    properties: JSON.stringify({
      sendId,
      campaignId: send.campaignId,
      ...(send.variant ? { variant: send.variant } : {}),
      ...properties,
    }),
    context: JSON.stringify({ channel: 'email' }),
    timestamp: receivedAt.toISOString(),
    received_at: receivedAt.toISOString(),
  };
}

export function createApp(deps: TrackingDeps) {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.header('X-Request-Id', requestId);
    await next();
    logger.info(
      { requestId, method: c.req.method, path: c.req.path, status: c.res.status },
      'request',
    );
  });

  // The open pixel is embedded cross-origin by mail clients, so this
  // service must not send Cross-Origin-Resource-Policy: same-origin.
  app.use('*', secureHeaders({ crossOriginResourcePolicy: false }));

  app.get('/healthz', (c) => c.json(healthPayload('tracking')));

  app.get('/metrics', async (c) =>
    c.text(await metricsRegistry.metrics(), 200, { 'content-type': metricsRegistry.contentType }),
  );

  app.get('/readyz', async (c) => {
    const checks: Record<string, 'ok' | 'failed'> = {};
    let ready = true;
    for (const [name, probe] of Object.entries(deps.readiness ?? {})) {
      try {
        await probe();
        checks[name] = 'ok';
      } catch {
        checks[name] = 'failed';
        ready = false;
      }
    }
    return c.json({ status: ready ? 'ok' : 'degraded', checks }, ready ? 200 : 503);
  });

  /**
   * Open pixel. Always answers with the GIF — a broken or unknown id
   * must never break email rendering; it just records nothing.
   */
  app.get('/o/:token', async (c) => {
    const sendId = c.req.param('token').replace(/\.gif$/, '');
    const send = await deps.sends.resolve(sendId);
    if (send) {
      await deps.producer
        .publish([engagementEvent(send, sendId, 'Email Opened', {}, now())])
        .catch((error: unknown) => logger.error({ error, sendId }, 'open event publish failed'));
      pixelServed.inc();
    } else {
      trackingRejected.inc({ reason: 'unknown_send' });
    }
    return c.body(PIXEL, 200, PIXEL_HEADERS);
  });

  /**
   * Click redirector. The target URL is HMAC-bound to the send id; a
   * bad signature is a 400, never a redirect — this endpoint must not
   * be usable as an open redirect.
   */
  app.get('/c/:sendId', async (c) => {
    const sendId = c.req.param('sendId');
    const target = c.req.query('u');
    const signature = c.req.query('s');
    if (!target || !signature) {
      trackingRejected.inc({ reason: 'missing_params' });
      return c.text('missing parameters', 400);
    }
    if (!(await verifyClickTarget(deps.secret, sendId, target, signature))) {
      trackingRejected.inc({ reason: 'bad_signature' });
      return c.text('invalid signature', 400);
    }

    const send = await deps.sends.resolve(sendId);
    if (send) {
      await deps.producer
        .publish([engagementEvent(send, sendId, 'Email Link Clicked', { url: target }, now())])
        .catch((error: unknown) => logger.error({ error, sendId }, 'click event publish failed'));
      redirectsServed.inc();
    } else {
      trackingRejected.inc({ reason: 'unknown_send' });
    }
    // Signature valid ⇒ the URL is exactly what the sender embedded.
    return c.redirect(target, 302);
  });

  return app;
}
