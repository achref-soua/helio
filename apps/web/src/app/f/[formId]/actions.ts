'use server';

import { contactEmailSchema, newId } from '@helio/core';
import { redirect } from 'next/navigation';

import { authDb } from '@/lib/auth';
import { checkPublicRateLimit } from '@/lib/public-rate-limit';

/**
 * Public form submission: upsert the contact into the form's workspace.
 * Idempotent on email; an existing contact only gains a first name it
 * was missing — a public form must never downgrade known data or
 * resurrect an unsubscribed contact.
 */
export async function submitForm(formData: FormData): Promise<void> {
  const formId = String(formData.get('formId') ?? '');
  // A throttled submission gets the same thank-you page as an invalid
  // email: the form never reveals what it accepted.
  const limit = await checkPublicRateLimit('form');
  if (!limit.allowed) redirect(`/f/${encodeURIComponent(formId)}?ok=1`);

  const parsedEmail = contactEmailSchema.safeParse(String(formData.get('email') ?? ''));
  const firstName = String(formData.get('firstName') ?? '').trim();

  const form = await authDb.form.findUnique({ where: { id: formId } });
  if (!form || !parsedEmail.success) redirect(`/f/${encodeURIComponent(formId)}?ok=1`);

  const email = parsedEmail.data;
  const existing = await authDb.contact.findUnique({
    where: { workspaceId_email: { workspaceId: form.workspaceId, email } },
  });
  if (existing) {
    if (!existing.firstName && firstName) {
      await authDb.contact.update({
        where: { id: existing.id },
        data: { firstName },
      });
    }
  } else {
    const contact = await authDb.contact.create({
      data: {
        id: newId('contact'),
        organizationId: form.organizationId,
        workspaceId: form.workspaceId,
        email,
        firstName: firstName || undefined,
        source: 'form',
      },
    });
    await authDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId: form.organizationId,
        workspaceId: form.workspaceId,
        action: 'contact.created',
        targetType: 'contact',
        targetId: contact.id,
        metadata: { via: 'form', formId: form.id },
      },
    });
  }
  redirect(`/f/${encodeURIComponent(formId)}?ok=1`);
}
