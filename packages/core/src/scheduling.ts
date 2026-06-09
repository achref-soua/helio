import { z } from 'zod';

/** One weekly availability window, expressed in the booking page's timezone. */
export interface AvailabilityRule {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes from local midnight, inclusive. */
  start: number;
  /** Minutes from local midnight, exclusive; must be greater than `start`. */
  end: number;
}

export const availabilityRuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start: z.number().int().min(0).max(1439),
    end: z.number().int().min(1).max(1440),
  })
  .refine((rule) => rule.end > rule.start, { message: 'end must be after start' });

export const availabilitySchema = z.array(availabilityRuleSchema).max(50);

/** Monday–Friday, 09:00–17:00. */
export const DEFAULT_AVAILABILITY: AvailabilityRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: 9 * 60,
  end: 17 * 60,
}));

/** True if the string is an IANA timezone the runtime understands. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset (ms) at a given UTC instant: `wallAsUtc - instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return wallAsUtc - instant.getTime();
}

/**
 * The absolute UTC instant for a wall-clock time (minutes from midnight) on a
 * calendar date in an IANA timezone. Dependency-free; one offset lookup, which
 * is exact except within the ~1h of a DST transition — acceptable for slots.
 */
export function zonedWallTimeToUtc(
  year: number,
  month0: number,
  day: number,
  minutes: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month0, day, Math.floor(minutes / 60), minutes % 60);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function localDateParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month0 = get('month') - 1;
  const day = get('day');
  // Weekday of a calendar date is timezone-independent.
  const weekday = new Date(Date.UTC(year, month0, day)).getUTCDay();
  return { year, month0, day, weekday };
}

export interface SlotQuery {
  rules: AvailabilityRule[];
  durationMinutes: number;
  bufferMinutes: number;
  timeZone: string;
  /** First day to consider (its local date in `timeZone` is used). */
  fromDate: Date;
  /** Number of consecutive days to generate from `fromDate`. */
  days: number;
  /** UTC ms of slot starts already taken. */
  bookedStarts: readonly number[];
  /** Slots at or before this instant are excluded (defaults to now). */
  now?: Date;
}

/**
 * Generate the open slot start instants for a booking page: walk each day in
 * the range, lay out `durationMinutes` slots (stepped by duration + buffer)
 * inside each matching availability window, and drop anything in the past or
 * already booked. Pure and timezone-correct.
 */
export function availableSlots(query: SlotQuery): Date[] {
  const now = query.now ?? new Date();
  const step = query.durationMinutes + query.bufferMinutes;
  if (step <= 0) return [];
  const booked = new Set(query.bookedStarts);
  const slots: Date[] = [];

  for (let d = 0; d < query.days; d += 1) {
    const dayInstant = new Date(query.fromDate.getTime() + d * 86_400_000);
    const { year, month0, day, weekday } = localDateParts(dayInstant, query.timeZone);
    for (const rule of query.rules) {
      if (rule.weekday !== weekday) continue;
      for (let m = rule.start; m + query.durationMinutes <= rule.end; m += step) {
        const slot = zonedWallTimeToUtc(year, month0, day, m, query.timeZone);
        if (slot.getTime() <= now.getTime()) continue;
        if (booked.has(slot.getTime())) continue;
        slots.push(slot);
      }
    }
  }

  slots.sort((a, b) => a.getTime() - b.getTime());
  return slots;
}
