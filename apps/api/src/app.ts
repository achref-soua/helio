import { randomUUID } from 'node:crypto';

import { OpenAPIHono } from '@hono/zod-openapi';

import { bearerAuth } from './middleware/auth';
import { idempotency } from './middleware/idempotency';
import { notFoundResponse, problemResponse } from './middleware/problem';
import { rateLimit } from './middleware/rate-limit';
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

  app.get('/healthz', (c) => c.json({ status: 'ok', service: 'api' }));

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

  // Authenticated, rate-limited, idempotent API surface.
  app.use('/v1/*', bearerAuth(deps.bootstrapToken));
  app.use('/v1/*', rateLimit(deps.redis, deps.rateLimit));
  app.use('/v1/*', idempotency(deps.redis));
  app.route('/', workspaceRoutes(deps));

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
