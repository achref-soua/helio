'use client';

import { type AvailabilityRule } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { cn } from '@helio/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Copy, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

// Monday-first display order; values are JS weekday numbers (0 = Sunday).
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function SchedulingView() {
  const t = useTranslations('scheduling');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const pageQuery = useQuery({
    ...trpc.scheduling.getPage.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  const meetingsQuery = useQuery({
    ...trpc.scheduling.listMeetings.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  const upsert = useMutation(trpc.scheduling.upsertPage.mutationOptions());
  const cancel = useMutation(trpc.scheduling.cancelMeeting.mutationOptions());

  const [seeded, setSeeded] = useState(false);
  const [title, setTitle] = useState('Intro call');
  const [duration, setDuration] = useState(30);
  const [timezone, setTimezone] = useState('UTC');
  const [buffer, setBuffer] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');

  const page = pageQuery.data;

  // Seed the form once: from the saved page, or from the browser's timezone.
  if (!seeded && (pageQuery.isSuccess || !workspaceId)) {
    setSeeded(true);
    if (page) {
      setTitle(page.title);
      setDuration(page.durationMinutes);
      setTimezone(page.timezone);
      setBuffer(page.bufferMinutes);
      setEnabled(page.enabled);
      const rules = (page.availability as unknown as AvailabilityRule[]) ?? [];
      if (rules.length > 0) {
        setDays(new Set(rules.map((rule) => rule.weekday)));
        setStart(minutesToTime(rules[0]!.start));
        setEnd(minutesToTime(rules[0]!.end));
      }
    } else {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    }
  }

  function toggleDay(weekday: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(weekday)) next.delete(weekday);
      else next.add(weekday);
      return next;
    });
  }

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const startM = timeToMinutes(start);
    const endM = timeToMinutes(end);
    if (endM <= startM) return toast.error(t('badHours'));
    if (days.size === 0) return toast.error(t('pickDay'));
    const availability = [...days]
      .sort((a, b) => a - b)
      .map((weekday) => ({ weekday, start: startM, end: endM }));
    try {
      await upsert.mutateAsync({
        workspaceId,
        id: page?.id,
        title: title.trim(),
        durationMinutes: duration,
        timezone: timezone.trim(),
        availability,
        bufferMinutes: buffer,
        enabled,
      });
      await queryClient.invalidateQueries(trpc.scheduling.getPage.pathFilter());
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onCancel(id: string) {
    try {
      await cancel.mutateAsync({ id });
      await queryClient.invalidateQueries(trpc.scheduling.listMeetings.pathFilter());
      toast.success(t('canceled'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  function copyLink() {
    if (!page) return;
    void navigator.clipboard?.writeText(`${window.location.origin}/m/${page.id}`);
    toast.success(t('linkCopied'));
  }

  if (!workspaceId || pageQuery.isLoading) {
    return <Skeleton className="h-72" data-testid="scheduling-loading" />;
  }

  const meetings = meetingsQuery.data ?? [];

  return (
    <div className="grid max-w-3xl gap-6">
      <div className="flex items-center gap-2">
        <CalendarClock className="text-primary size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>
      <p className="text-muted-foreground -mt-4 text-sm">{t('subtitle')}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('pageTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="sched-title">{t('name')}</Label>
              <Input
                id="sched-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                required
                data-testid="sched-title"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="sched-duration">{t('duration')}</Label>
                <Input
                  id="sched-duration"
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sched-buffer">{t('buffer')}</Label>
                <Input
                  id="sched-buffer"
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  value={buffer}
                  onChange={(event) => setBuffer(Number(event.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sched-tz">{t('timezone')}</Label>
                <Input
                  id="sched-tz"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="UTC"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t('days')}</span>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((weekday) => (
                  <Button
                    key={weekday}
                    type="button"
                    variant={days.has(weekday) ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-8 w-12"
                    aria-pressed={days.has(weekday)}
                    onClick={() => toggleDay(weekday)}
                    data-testid={`sched-day-${weekday}`}
                  >
                    {t(`weekday.${weekday}`)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sched-start">{t('startTime')}</Label>
                <Input
                  id="sched-start"
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sched-end">{t('endTime')}</Label>
                <Input
                  id="sched-end"
                  type="time"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                data-testid="sched-enabled"
              />
              {t('enabled')}
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={upsert.isPending} data-testid="sched-save">
                {upsert.isPending ? t('saving') : t('save')}
              </Button>
              {page && (
                <button
                  type="button"
                  onClick={copyLink}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                  data-testid="sched-copy-link"
                >
                  <Copy className="size-3" aria-hidden />
                  <code>/m/{page.id}</code>
                </button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('upcoming')}</CardTitle>
        </CardHeader>
        <CardContent>
          {meetings.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="scheduling-empty">
              {t('noMeetings')}
            </p>
          ) : (
            <ul className="grid gap-2">
              {meetings.map((meeting) => (
                <li
                  key={meeting.id}
                  className={cn('flex items-center gap-3 rounded-md border p-3 text-sm')}
                  data-testid="meeting-row"
                >
                  <span className="tabular-nums">
                    {new Date(meeting.startAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {meeting.inviteeName ? `${meeting.inviteeName} · ` : ''}
                    {meeting.inviteeEmail}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-8"
                    aria-label={t('cancelLabel', { email: meeting.inviteeEmail })}
                    onClick={() => onCancel(meeting.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
