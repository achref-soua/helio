import { type AvailabilityRule, availableSlots } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BrandStyle } from '@/components/brand-style';
import { PoweredBy } from '@/components/powered-by';
import { ThemedSelect } from '@/components/themed-select';
import { authDb } from '@/lib/auth';

import { bookMeeting } from './actions';

const BOOKING_WINDOW_DAYS = 14;
const KNOWN_ERRORS = ['unavailable', 'email', 'taken'] as const;

/**
 * Public booking page. No auth: the page id is the capability. Slots are
 * computed server-side in the page's timezone; the booking action re-validates
 * the chosen slot, so the rendered options are a convenience, not the gate.
 */
export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { pageId } = await params;
  const { ok, error } = await searchParams;
  const t = await getTranslations('booking');

  const page = await authDb.bookingPage.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      description: true,
      durationMinutes: true,
      timezone: true,
      availability: true,
      bufferMinutes: true,
      enabled: true,
      workspace: {
        select: {
          organization: {
            select: { name: true, brandName: true, brandColor: true, logo: true },
          },
        },
      },
    },
  });
  // A real 404, not a 200 with sad text — crawlers and uptime checks care.
  if (!page || !page.enabled) notFound();
  const brand = page.workspace.organization;

  let slots: Date[] = [];
  if (page?.enabled) {
    const booked = await authDb.meeting.findMany({
      where: { bookingPageId: page.id, status: 'BOOKED', startAt: { gte: new Date() } },
      select: { startAt: true },
    });
    slots = availableSlots({
      rules: (page.availability as unknown as AvailabilityRule[]) ?? [],
      durationMinutes: page.durationMinutes,
      bufferMinutes: page.bufferMinutes,
      timeZone: page.timezone,
      fromDate: new Date(),
      days: BOOKING_WINDOW_DAYS,
      bookedStarts: booked.map((meeting) => meeting.startAt.getTime()),
    });
  }

  // Group slots by their local day for <optgroup>s.
  const groups = new Map<string, Date[]>();
  if (page) {
    const dayFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: page.timezone,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    for (const slot of slots) {
      const key = dayFmt.format(slot);
      const bucket = groups.get(key);
      if (bucket) bucket.push(slot);
      else groups.set(key, [slot]);
    }
  }
  const timeFmt = page
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: page.timezone,
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  const errorMessage =
    error && (KNOWN_ERRORS as readonly string[]).includes(error) ? t(`error.${error}`) : null;

  return (
    <main className="bg-muted/30 flex min-h-svh flex-col p-6">
      <BrandStyle color={brand?.brandColor} />
      <div className="m-auto grid w-full max-w-md gap-4">
        {brand && (brand.brandName || brand.logo) && (
          <div className="flex items-center justify-center gap-2 font-semibold">
            {brand.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} alt="" className="size-6 rounded object-contain" />
            )}
            <span>{brand.brandName ?? brand.name}</span>
          </div>
        )}
        <Card className="w-full">
          {ok ? (
            <CardHeader>
              <CardTitle>{t('bookedTitle')}</CardTitle>
              <CardDescription>{t('bookedBody')}</CardDescription>
            </CardHeader>
          ) : (
            <>
              <CardHeader>
                <CardTitle>
                  <h1 className="text-lg leading-none font-semibold">{page.title}</h1>
                </CardTitle>
                <CardDescription>
                  {page.description || t('subtitle', { minutes: page.durationMinutes })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {errorMessage && <p className="text-destructive mb-3 text-sm">{errorMessage}</p>}
                {slots.length === 0 ? (
                  <p className="text-muted-foreground text-sm" data-testid="booking-no-slots">
                    {t('noSlots')}
                  </p>
                ) : (
                  <form action={bookMeeting} className="grid gap-4" data-testid="booking-form">
                    <input type="hidden" name="pageId" value={page.id} />
                    <div className="grid gap-2">
                      <Label htmlFor="slot">{t('slot')}</Label>
                      <ThemedSelect
                        id="slot"
                        name="slot"
                        required
                        defaultValue={slots[0]?.toISOString()}
                        className="w-full"
                        groups={[...groups.entries()].map(([day, daySlots]) => ({
                          label: day,
                          options: daySlots.map((slot) => ({
                            value: slot.toISOString(),
                            label: timeFmt?.format(slot) ?? '',
                          })),
                        }))}
                      />
                      <p className="text-muted-foreground text-xs">
                        {t('timezone', { tz: page.timezone })}
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="booking-email">{t('email')}</Label>
                      <Input
                        id="booking-email"
                        name="email"
                        type="email"
                        required
                        maxLength={320}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="booking-name">{t('name')}</Label>
                      <Input id="booking-name" name="name" maxLength={120} />
                    </div>
                    <Button type="submit">{t('book')}</Button>
                  </form>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
      <PoweredBy whiteLabeled={Boolean(brand && (brand.brandName || brand.logo))} />
    </main>
  );
}
