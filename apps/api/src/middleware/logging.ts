import { createMiddleware } from 'hono/factory';
import { pino } from 'pino';

import { httpRequestDuration } from '../observability';
import type { GatewayEnv } from '../types';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: { level: (label) => ({ level: label }) },
});

/** Structured request log + duration metric for every request. */
export const requestLogging = createMiddleware<GatewayEnv>(async (c, next) => {
  const startedAt = performance.now();
  await next();
  const durationSeconds = (performance.now() - startedAt) / 1000;
  const route = c.req.routePath ?? c.req.path;
  httpRequestDuration.observe(
    { method: c.req.method, route, status: String(c.res.status) },
    durationSeconds,
  );
  logger.info(
    {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(durationSeconds * 1000),
    },
    'request',
  );
});
