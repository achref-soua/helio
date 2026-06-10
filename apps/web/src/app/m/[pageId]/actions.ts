'use server';

import { type AvailabilityRule, availableSlots, contactEmailSchema, newId } from '@helio/core';
import { redirect } from 'next/navigation';

import { authDb } from '@/lib/auth';
import { checkPublicRateLimit } from '@/lib/public-rate-limit';

const BOOKING_WINDOW_DAYS = 14;

/**
 * Public booking. Server-authoritative: the chosen slot must be one the page
 * genuinely offers and still has open, so an invitee can't book the past, an
 * off-hours time, or a taken slot. The unique (bookingPageId, startAt) turns a
 * race into a caught conflict, and a MEETING task files the meeting into the
 * owner's CRM.
 */
export async function bookMeeting(formData: FormData): Promise<void> {
  const pageId = String(formData.get('pageId') ?? '');
  const slotIso = String(formData.get('slot') ?? '');
  const parsedEmail = contactEmailSchema.safeParse(String(formData.get('email') ?? ''));
  const name = String(formData.get('name') ?? '').trim();

  const back = (reason: string) => `/m/${encodeURIComponent(pageId)}?error=${reason}`;

  const limit = await checkPublicRateLimit('booking');
  if (!limit.allowed) redirect(back('unavailable'));

  const page = await authDb.bookingPage.findUnique({ where: { id: pageId } });
  if (!page || !page.enabled) redirect(back('unavailable'));
  if (!parsedEmail.success) redirect(back('email'));

  const slot = new Date(slotIso);
  if (Number.isNaN(slot.getTime())) redirect(back('unavailable'));

  const booked = await authDb.meeting.findMany({
    where: { bookingPageId: page.id, status: 'BOOKED', startAt: { gte: new Date() } },
    select: { startAt: true },
  });
  const open = availableSlots({
    rules: (page.availability as unknown as AvailabilityRule[]) ?? [],
    durationMinutes: page.durationMinutes,
    bufferMinutes: page.bufferMinutes,
    timeZone: page.timezone,
    fromDate: new Date(),
    days: BOOKING_WINDOW_DAYS,
    bookedStarts: booked.map((meeting) => meeting.startAt.getTime()),
  });
  if (!open.some((s) => s.getTime() === slot.getTime())) redirect(back('taken'));

  // Upsert the invitee contact — never downgrade known data or resurrect an
  // unsubscribed contact (same rule as hosted forms).
  const email = parsedEmail.data;
  const existing = await authDb.contact.findUnique({
    where: { workspaceId_email: { workspaceId: page.workspaceId, email } },
  });
  let contactId: string;
  if (existing) {
    contactId = existing.id;
    if (!existing.firstName && name) {
      await authDb.contact.update({ where: { id: existing.id }, data: { firstName: name } });
    }
  } else {
    const contact = await authDb.contact.create({
      data: {
        id: newId('contact'),
        organizationId: page.organizationId,
        workspaceId: page.workspaceId,
        email,
        firstName: name || undefined,
        source: 'booking',
      },
    });
    contactId = contact.id;
  }

  try {
    await authDb.meeting.create({
      data: {
        id: newId('mtg'),
        organizationId: page.organizationId,
        workspaceId: page.workspaceId,
        bookingPageId: page.id,
        startAt: slot,
        durationMinutes: page.durationMinutes,
        inviteeEmail: email,
        inviteeName: name || null,
        contactId,
      },
    });
  } catch {
    // Unique (bookingPageId, startAt) — someone took it between our check and
    // the insert.
    redirect(back('taken'));
  }

  await authDb.task.create({
    data: {
      id: newId('task'),
      organizationId: page.organizationId,
      workspaceId: page.workspaceId,
      title: `Meeting with ${name || email}`,
      type: 'MEETING',
      priority: 'MEDIUM',
      dueAt: slot,
      contactId,
      ownerId: page.ownerId,
    },
  });

  redirect(`/m/${encodeURIComponent(pageId)}?ok=1`);
}
