'use server';

import { contactEmailSchema, newId } from '@helio/core';
import { redirect } from 'next/navigation';

import { authDb } from '@/lib/auth';

/**
 * Landing-page form capture: upsert the email into the page's workspace, the
 * same way hosted forms do (never downgrade or resurrect an unsubscribed
 * contact). The page id is the capability.
 */
export async function submitLandingForm(formData: FormData): Promise<void> {
  const pageId = String(formData.get('pageId') ?? '');
  const parsedEmail = contactEmailSchema.safeParse(String(formData.get('email') ?? ''));
  const back = `/p/${encodeURIComponent(pageId)}?ok=1`;

  const page = await authDb.landingPage.findUnique({ where: { id: pageId } });
  if (!page || !page.published || !parsedEmail.success) redirect(back);

  const email = parsedEmail.data;
  const existing = await authDb.contact.findUnique({
    where: { workspaceId_email: { workspaceId: page.workspaceId, email } },
  });
  if (!existing) {
    const contact = await authDb.contact.create({
      data: {
        id: newId('contact'),
        organizationId: page.organizationId,
        workspaceId: page.workspaceId,
        email,
        source: 'landing',
      },
    });
    await authDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId: page.organizationId,
        workspaceId: page.workspaceId,
        action: 'contact.created',
        targetType: 'contact',
        targetId: contact.id,
        metadata: { via: 'landing', pageId: page.id },
      },
    });
  }
  redirect(back);
}
