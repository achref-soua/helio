import { describe, expect, it } from 'vitest';

import { HelioError, isHelioError, toProblemDetails } from '../src/errors';

describe('HelioError', () => {
  it('maps every code to its HTTP status', () => {
    expect(HelioError.validation('bad').status).toBe(400);
    expect(HelioError.unauthorized().status).toBe(401);
    expect(HelioError.forbidden().status).toBe(403);
    expect(HelioError.notFound('missing').status).toBe(404);
    expect(HelioError.conflict('dup').status).toBe(409);
    expect(HelioError.rateLimited().status).toBe(429);
    expect(HelioError.internal().status).toBe(500);
  });

  it('preserves cause and details', () => {
    const cause = new Error('db down');
    const error = new HelioError('internal', 'query failed', {
      cause,
      details: { table: 'contacts' },
    });
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ table: 'contacts' });
  });

  it('narrows via isHelioError', () => {
    expect(isHelioError(HelioError.notFound('x'))).toBe(true);
    expect(isHelioError(new Error('x'))).toBe(false);
    expect(isHelioError('x')).toBe(false);
  });
});

describe('toProblemDetails', () => {
  it('serializes a HelioError to RFC 9457 shape', () => {
    const problem = toProblemDetails(
      HelioError.validation('email is required', { details: { field: 'email' } }),
      '/v1/contacts',
    );
    expect(problem).toEqual({
      type: 'urn:helio:problem:validation',
      title: 'validation',
      status: 400,
      detail: 'email is required',
      details: { field: 'email' },
      instance: '/v1/contacts',
    });
  });

  it('never leaks internals of unexpected errors', () => {
    const problem = toProblemDetails(new Error('password=hunter2 leaked stack'));
    expect(problem.status).toBe(500);
    expect(problem.detail).toBe('Internal error');
    expect(JSON.stringify(problem)).not.toContain('hunter2');
  });
});
