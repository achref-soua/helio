import { randomUUID } from 'node:crypto';

import { OpenAPIHono } from '@hono/zod-openapi';
import { secureHeaders } from 'hono/secure-headers';

import { apiKeyAuth } from './middleware/api-key';
import { idempotency } from './middleware/idempotency';
import { requestLogging } from './middleware/logging';
import { notFoundResponse, problemResponse } from './middleware/problem';
import { rateLimit } from './middleware/rate-limit';
import { metricsRegistry } from './observability';
import { contactRoutes } from './routes/contacts';
import { emailWebhookRoutes } from './routes/email-webhook';
import { listRoutes } from './routes/lists';
import { shopifyWebhookRoutes } from './routes/shopify-webhook';
import { stripeWebhookRoutes } from './routes/stripe-webhook';
import { workspaceRoutes } from './routes/workspaces';
import type { GatewayDeps, GatewayEnv } from './types';

export const API_VERSION = '0.1.0';

export function createApp(deps: GatewayDeps) {
  const app = new OpenAPIHono<GatewayEnv>();

  app.onError(problemResponse);
  app.notFound(notFoundResponse);

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    await next();
  });

  app.use('*', requestLogging);
  app.use('*', secureHeaders());

  app.get('/healthz', (c) => c.json({ status: 'ok', service: 'api' }));

  app.get('/metrics', async (c) =>
    c.text(await metricsRegistry.metrics(), 200, { 'content-type': metricsRegistry.contentType }),
  );

  app.get('/readyz', async (c) => {
    const checks: Record<string, 'ok' | 'failed'> = { database: 'failed', redis: 'failed' };
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      /* reported below */
    }
    try {
      if ((await deps.redis.ping()) === 'PONG') checks.redis = 'ok';
    } catch {
      /* reported below */
    }
    const ready = Object.values(checks).every((status) => status === 'ok');
    return c.json({ status: ready ? 'ok' : 'degraded', checks }, ready ? 200 : 503);
  });

  // Provider webhooks authenticate by signature or shared token, not the
  // bearer token, so they mount before the /v1 auth middleware.
  app.route('/', stripeWebhookRoutes(deps));
  app.route('/', shopifyWebhookRoutes(deps));
  app.route('/', emailWebhookRoutes(deps));

  // Authenticated (per-org API key), rate-limited, idempotent API surface.
  app.use('/v1/*', apiKeyAuth(deps));
  app.use('/v1/*', rateLimit(deps.redis, deps.rateLimit));
  app.use('/v1/*', idempotency(deps.redis));
  app.route('/', workspaceRoutes(deps));
  app.route('/', contactRoutes(deps));
  app.route('/', listRoutes(deps));

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
  });

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Helio API',
      version: API_VERSION,
      description:
        'Public REST gateway for Helio. Errors follow RFC 9457 problem+json; mutating endpoints accept Idempotency-Key.',
    },
  });

  return app;
}
