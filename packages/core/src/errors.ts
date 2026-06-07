/** Stable machine-readable error codes used across all Helio services. */
export type HelioErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal';

const HTTP_STATUS: Record<HelioErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

interface HelioErrorOptions {
  cause?: unknown;
  /** Safe-to-expose structured context (field names, limits). Never secrets. */
  details?: unknown;
}

/**
 * Base error for expected failure modes. Anything that is not a HelioError
 * is treated as an unexpected internal error at the edges and never has its
 * message exposed to clients.
 */
export class HelioError extends Error {
  readonly code: HelioErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: HelioErrorCode, message: string, options: HelioErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HelioError';
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = options.details;
  }

  static validation(message: string, options?: HelioErrorOptions): HelioError {
    return new HelioError('validation', message, options);
  }
  static unauthorized(
    message = 'Authentication required',
    options?: HelioErrorOptions,
  ): HelioError {
    return new HelioError('unauthorized', message, options);
  }
  static forbidden(message = 'Insufficient permissions', options?: HelioErrorOptions): HelioError {
    return new HelioError('forbidden', message, options);
  }
  static notFound(message: string, options?: HelioErrorOptions): HelioError {
    return new HelioError('not_found', message, options);
  }
  static conflict(message: string, options?: HelioErrorOptions): HelioError {
    return new HelioError('conflict', message, options);
  }
  static rateLimited(message = 'Rate limit exceeded', options?: HelioErrorOptions): HelioError {
    return new HelioError('rate_limited', message, options);
  }
  static internal(message = 'Internal error', options?: HelioErrorOptions): HelioError {
    return new HelioError('internal', message, options);
  }
}

export function isHelioError(value: unknown): value is HelioError {
  return value instanceof HelioError;
}

/** RFC 9457 problem-details document. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

/**
 * Map any thrown value to an RFC 9457 problem document for HTTP responses.
 * Unexpected errors are flattened to a generic 500 so internals never leak.
 */
export function toProblemDetails(error: unknown, instance?: string): ProblemDetails {
  if (isHelioError(error)) {
    return {
      type: `urn:helio:problem:${error.code}`,
      title: error.code.replaceAll('_', ' '),
      status: error.status,
      detail: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(instance === undefined ? {} : { instance }),
    };
  }
  return {
    type: 'urn:helio:problem:internal',
    title: 'internal',
    status: 500,
    detail: 'Internal error',
    ...(instance === undefined ? {} : { instance }),
  };
}
