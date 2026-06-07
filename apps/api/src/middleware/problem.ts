import { toProblemDetails } from '@helio/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Hono error handler: every failure leaves as RFC 9457 problem+json. */
export function problemResponse(error: unknown, c: Context) {
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
}

export function notFoundResponse(c: Context) {
  const problem = {
    type: 'urn:helio:problem:not_found',
    title: 'not found',
    status: 404,
    instance: c.req.path,
  };
  return c.body(JSON.stringify(problem), 404, { 'content-type': PROBLEM_CONTENT_TYPE });
}
