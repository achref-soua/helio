'use server';

import { newId, verifyUnsubscribeToken } from '@helio/core';
import { revalidatePath } from 'next/cache';

import { authDb } from '@/lib/auth';
import { env } from '@/lib/env';

/**
 * Flip the contact to UNSUBSCRIBED. Token-authorized public mutation —
 * idempotent, audit-logged, and silent about unknown tokens.
 */
export async function unsubscribeContact(formData: FormData): Promise<void> {
  const token = decodeURIComponent(String(formData.get('token') ?? ''));
  const contactId = await verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, token);
  if (!contactId) return;

  const contact = await authDb.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.status === 'UNSUBSCRIBED') return;

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
      metadata: { via: 'preference_page' },
    },
  });
  revalidatePath(`/u`);
}
