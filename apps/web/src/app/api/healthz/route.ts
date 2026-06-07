/** Liveness probe. Readiness (with dependency checks) ships with observability. */
export function GET() {
  return Response.json({ status: 'ok', service: 'web' });
}
