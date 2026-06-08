import { randomUUID } from 'node:crypto';

import { eventBatchSchema, pushSubscriptionSchema, toProblemDetails } from '@helio/core';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { pino } from 'pino';

import { enrichEvent } from './enrich';
import {
  batchesRejected,
  eventsAccepted,
  httpRequestDuration,
  metricsRegistry,
} from './observability';
import type { IngestDeps, IngestEnv } from './types';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: { level: (label) => ({ level: label }) },
});

/**
 * Pull the write key from, in order: Basic auth username (Segment-style),
 * a Bearer token, the X-Write-Key header, or the body — sendBeacon cannot
 * set headers, so browser flush-on-unload rides the body.
 */
function extractWriteKey(
  authorization: string | undefined,
  headerKey: string | undefined,
  bodyKey: string | undefined,
): string | null {
  if (authorization?.startsWith('Basic ')) {
    try {
      const decoded = atob(authorization.slice('Basic '.length));
      const separator = decoded.indexOf(':');
      const username = separator === -1 ? decoded : decoded.slice(0, separator);
      if (username) return username;
    } catch {
      return null;
    }
  }
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return headerKey ?? bodyKey ?? null;
}

function reject(status: 400 | 401 | 404 | 422 | 429, reason: string, message: string): never {
  batchesRejected.inc({ reason });
  throw new HTTPException(status, { message });
}

export function createApp(deps: IngestDeps) {
  const app = new Hono<IngestEnv>();
  const now = deps.now ?? (() => new Date());

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const problem = {
        type: `urn:helio:problem:http_${error.status}`,
        title: error.message || 'request failed',
        status: error.status,
        instance: c.req.path,
      };
      return c.body(JSON.stringify(problem), error.status, {
        'content-type': PROBLEM_CONTENT_TYPE,
      });
    }
    const problem = toProblemDetails(error, c.req.path);
    return c.body(JSON.stringify(problem), problem.status as 500, {
      'content-type': PROBLEM_CONTENT_TYPE,
    });
  });

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
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
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(durationSeconds * 1000),
      },
      'request',
    );
  });

  app.get('/healthz', (c) => c.json({ status: 'ok', service: 'ingest' }));

  app.get('/metrics', async (c) =>
    c.text(await metricsRegistry.metrics(), 200, { 'content-type': metricsRegistry.contentType }),
  );

  app.get('/readyz', async (c) => {
    const checks: Record<string, 'ok' | 'failed'> = {};
    let ready = true;
    const probes: Record<string, () => Promise<void>> = {
      redis: async () => {
        if ((await deps.redis.ping()) !== 'PONG') throw new Error('redis not ready');
      },
      ...deps.readiness,
    };
    for (const [name, probe] of Object.entries(probes)) {
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

  // Browser SDKs post cross-origin; the write key is the credential, so
  // any origin may attempt — auth decides, not CORS.
  app.use(
    '/v1/*',
    cors({
      origin: (origin) => origin,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Write-Key'],
      maxAge: 86_400,
    }),
  );
  app.use('/v1/*', bodyLimit({ maxSize: 1024 * 1024 }));

  /** Fixed-window per-workspace budget shared across replicas via Redis. */
  async function enforceRateLimit(c: Context<IngestEnv>, workspaceId: string): Promise<void> {
    const window = Math.floor(Date.now() / 1000 / deps.rateLimit.windowSeconds);
    const key = `ingest:ratelimit:${window}:${workspaceId}`;
    const count = await deps.redis.incr(key);
    if (count === 1) await deps.redis.expire(key, deps.rateLimit.windowSeconds);
    c.header('RateLimit-Limit', String(deps.rateLimit.max));
    c.header('RateLimit-Remaining', String(Math.max(0, deps.rateLimit.max - count)));
    if (count > deps.rateLimit.max) {
      const ttl = await deps.redis.ttl(key);
      c.header('Retry-After', String(Math.max(1, ttl)));
      reject(429, 'rate_limited', 'rate limit exceeded');
    }
  }

  /** Resolve the write key from headers/body, or reject. */
  async function authorize(c: Context<IngestEnv>, body: unknown) {
    const bodyKey =
      typeof body === 'object' && body !== null && 'writeKey' in body
        ? String((body as { writeKey?: unknown }).writeKey ?? '')
        : undefined;
    const key = extractWriteKey(
      c.req.header('authorization'),
      c.req.header('x-write-key'),
      bodyKey || undefined,
    );
    if (!key) reject(401, 'missing_key', 'write key required');
    const scope = await deps.keys.resolve(key);
    if (!scope) reject(401, 'unknown_key', 'unknown or revoked write key');
    return scope;
  }

  app.post('/v1/batch', async (c) => {
    // Parse once up front; auth may need the body-borne writeKey.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      reject(400, 'invalid_json', 'request body must be JSON');
    }
    const scope = await authorize(c, body);
    await enforceRateLimit(c, scope.workspaceId);

    const parsed = eventBatchSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      reject(422, 'invalid_batch', `invalid batch — ${detail}`);
    }

    const receivedAt = now();
    const enriched = parsed.data.batch.map((event) => enrichEvent(event, scope, receivedAt));
    await deps.producer.publish(enriched);
    for (const event of enriched) eventsAccepted.inc({ type: event.type });

    return c.json({ accepted: enriched.length }, 202);
  });

  app.post('/v1/push/subscribe', async (c) => {
    if (!deps.pushStore) reject(404, 'push_disabled', 'push is not enabled on this deployment');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      reject(400, 'invalid_json', 'request body must be JSON');
    }
    const scope = await authorize(c, body);
    await enforceRateLimit(c, scope.workspaceId);

    const parsed = pushSubscriptionSchema.safeParse(body);
    if (!parsed.success) reject(422, 'invalid_subscription', 'invalid push subscription');

    await deps.pushStore.upsert({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userId: parsed.data.userId,
    });
    return c.json({ subscribed: true }, 202);
  });

  return app;
}
