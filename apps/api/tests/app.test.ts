import { toProblemDetails } from '@helio/core';
import type { Context } from 'hono';
import RedisMock from 'ioredis-mock';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { notFoundResponse, problemResponse } from '../src/middleware/problem';
import type { RedisLike } from '../src/types';

/** Prisma stub whose readiness probe can be toggled to fail. */
function makeApp(databaseUp: boolean) {
  const prisma = {
    $queryRaw: databaseUp
      ? vi.fn().mockResolvedValue([{ '?column?': 1 }])
      : vi.fn().mockRejectedValue(new Error('db down')),
  } as never;
  return createApp({
    prisma,
    redis: new RedisMock() as unknown as RedisLike,
    rateLimit: { max: 100, windowSeconds: 3600 },
  });
}

describe('gateway app surface', () => {
  it('serves Prometheus metrics', async () => {
    const response = await makeApp(true).request('/metrics');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('helio_api_');
  });

  it('readyz reports degraded with a 503 when the database probe fails', async () => {
    const response = await makeApp(false).request('/readyz');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'degraded',
      checks: { database: 'failed', redis: 'ok' },
    });
  });

  it('unknown routes return problem+json 404', async () => {
    const response = await makeApp(true).request('/nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({
      status: 404,
      type: 'urn:helio:problem:not_found',
    });
  });
});

describe('problem middleware', () => {
  const ctx = (path: string) =>
    ({
      req: { path },
      body: (text: string, status: number, headers: Record<string, string>) =>
        new Response(text, { status, headers }),
    }) as unknown as Context;

  it('renders a generic non-HTTPException as a 500 problem document', async () => {
    const response = problemResponse(new Error('kaboom'), ctx('/v1/things'));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    const body = (await response.json()) as { status: number; instance: string };
    expect(body.status).toBe(500);
    expect(body.instance).toBe('/v1/things');
    // Mirrors what callers see from the shared helper.
    expect(toProblemDetails(new Error('kaboom'), '/v1/things').status).toBe(500);
  });

  it('notFoundResponse is problem+json', async () => {
    const response = notFoundResponse(ctx('/missing'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: 404 });
  });
});
