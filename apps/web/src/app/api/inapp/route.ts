import { NextResponse } from 'next/server';

import { authDb } from '@/lib/auth';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/public-rate-limit';

// Polled cross-origin by the tracking SDK for the identified visitor. Returns
// only that contact's unseen, live in-app messages, scoped to the write key's
// workspace. Per-contact, so never cached.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'no-store',
};

interface InAppMessagePayload {
  deliveryId: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function workspaceForKey(key: string | null): Promise<string | null> {
  if (!key) return null;
  const writeKey = await authDb.writeKey.findUnique({
    where: { key },
    select: { workspaceId: true, revokedAt: true },
  });
  return writeKey && !writeKey.revokedAt ? writeKey.workspaceId : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = await checkPublicRateLimit('inappRead', params.get('key') ?? '');
  if (!limit.allowed) return rateLimitedResponse(limit, CORS);

  const empty = NextResponse.json({ messages: [] }, { headers: CORS });

  const email = params.get('email')?.trim().toLowerCase();
  const workspaceId = await workspaceForKey(params.get('key'));
  if (!workspaceId || !email) return empty;

  const contact = await authDb.contact.findUnique({
    where: { workspaceId_email: { workspaceId, email } },
    select: { id: true },
  });
  if (!contact) return empty;

  const deliveries = await authDb.inAppDelivery.findMany({
    where: { contactId: contact.id, seenAt: null, message: { active: true } },
    select: {
      id: true,
      message: { select: { title: true, body: true, ctaLabel: true, ctaUrl: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  const messages: InAppMessagePayload[] = deliveries.map((delivery) => ({
    deliveryId: delivery.id,
    title: delivery.message.title,
    body: delivery.message.body,
    ctaLabel: delivery.message.ctaLabel,
    ctaUrl: delivery.message.ctaUrl,
  }));
  return NextResponse.json({ messages }, { headers: CORS });
}

export async function POST(request: Request) {
  const limit = await checkPublicRateLimit('inappWrite');
  if (!limit.allowed) return rateLimitedResponse(limit, CORS);

  const body = (await request.json().catch(() => null)) as {
    key?: string;
    deliveryIds?: unknown;
  } | null;
  const ok = NextResponse.json({ ok: true, seen: 0 }, { headers: CORS });

  const workspaceId = await workspaceForKey(body?.key ?? null);
  const ids = Array.isArray(body?.deliveryIds)
    ? body.deliveryIds.filter((id): id is string => typeof id === 'string').slice(0, 50)
    : [];
  if (!workspaceId || ids.length === 0) return ok;

  // Scope the update to the key's workspace so a key can only clear its own
  // deliveries, even if it guesses another tenant's delivery ids.
  const { count } = await authDb.inAppDelivery.updateMany({
    where: { id: { in: ids }, workspaceId, seenAt: null },
    data: { seenAt: new Date() },
  });
  return NextResponse.json({ ok: true, seen: count }, { headers: CORS });
}
