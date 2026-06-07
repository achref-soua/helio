import { newId, verifyUnsubscribeToken } from '@helio/core';
import { NextResponse } from 'next/server';

import { authDb } from '@/lib/auth';
import { env } from '@/lib/env';

/**
 * RFC 8058 one-click unsubscribe: mail providers POST here directly
 * (List-Unsubscribe-Post), no page render involved. Idempotent; always
 * 200 so providers don't retry-spam, even for stale tokens.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  const contactId = await verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, decodeURIComponent(token));
  if (contactId) {
    const contact = await authDb.contact.findUnique({ where: { id: contactId } });
    if (contact && contact.status !== 'UNSUBSCRIBED') {
      await authDb.contact.update({
        where: { id: contactId },
        data: { status: 'UNSUBSCRIBED' },
      });
      await authDb.auditLog.create({
        data: {
          id: newId('audit'),
          organizationId: contact.organizationId,
          workspaceId: contact.workspaceId,
          action: 'contact.unsubscribed',
          targetType: 'contact',
          targetId: contact.id,
          metadata: { via: 'one_click' },
        },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
