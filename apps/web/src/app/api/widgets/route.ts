import { type WidgetPayload } from '@helio/core';
import { NextResponse } from 'next/server';

import { authDb } from '@/lib/auth';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/public-rate-limit';

// The embed loads cross-origin from the customer's site; only active widgets
// (public content) are returned, scoped to the write key's workspace.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key');
  const limit = await checkPublicRateLimit('widgets', key ?? '');
  if (!limit.allowed) return rateLimitedResponse(limit, CORS);

  const empty = NextResponse.json({ widgets: [] }, { headers: CORS });
  if (!key) return empty;

  const writeKey = await authDb.writeKey.findUnique({
    where: { key },
    select: { workspaceId: true, revokedAt: true },
  });
  if (!writeKey || writeKey.revokedAt) return empty;

  const widgets = await authDb.widget.findMany({
    where: { workspaceId: writeKey.workspaceId, active: true },
    select: { id: true, type: true, title: true, body: true, ctaLabel: true, ctaUrl: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  return NextResponse.json({ widgets: widgets satisfies WidgetPayload[] }, { headers: CORS });
}
