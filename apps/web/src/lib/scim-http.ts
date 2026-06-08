import { SCIM_CONTENT_TYPE, scimError } from '@helio/core';

import { env } from '@/lib/env';
import { resolveScimOrg } from '@/lib/scim';

/** Base URL of the SCIM service provider, e.g. https://app/scim/v2. */
export function scimBase(): string {
  return `${env.APP_URL}/scim/v2`;
}

/** A JSON response with the SCIM media type. */
export function scimJson(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': SCIM_CONTENT_TYPE, ...headers },
  });
}

/** A SCIM error response. 401s advertise bearer auth per RFC 7644. */
export function scimErrorResponse(status: number, detail: string, scimType?: string): Response {
  return scimJson(
    scimError(status, detail, scimType),
    status,
    status === 401 ? { 'www-authenticate': 'Bearer' } : undefined,
  );
}

/**
 * Resolve the SCIM bearer token to an organization and run `handler`, or
 * answer 401. Every tenant-touching SCIM endpoint goes through this, so an
 * IdP only ever sees the org its token belongs to.
 */
export async function withScimOrg(
  request: Request,
  handler: (organizationId: string) => Promise<Response>,
): Promise<Response> {
  const organizationId = await resolveScimOrg(request);
  if (!organizationId) {
    return scimErrorResponse(401, 'Missing or invalid SCIM bearer token.');
  }
  return handler(organizationId);
}
