import { healthPayload } from '@helio/core';

/** Liveness probe. Readiness (with dependency checks) ships with observability. */
export function GET() {
  return Response.json(healthPayload('web'));
}
