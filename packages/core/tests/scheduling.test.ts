import { describe, expect, it } from 'vitest';

import {
  availabilitySchema,
  availableSlots,
  DEFAULT_AVAILABILITY,
  isValidTimeZone,
  zonedWallTimeToUtc,
} from '../src/scheduling';

// 2026-01-05 is a Monday (weekday 1); January is EST (UTC-5) in New York.
const past = new Date('2026-01-01T00:00:00Z');

describe('zonedWallTimeToUtc', () => {
  it('maps a wall-clock time in a zone to the right UTC instant', () => {
    expect(zonedWallTimeToUtc(2026, 0, 5, 9 * 60, 'UTC').toISOString()).toBe(
      '2026-01-05T09:00:00.000Z',
    );
    // 09:00 EST = 14:00 UTC
    expect(zonedWallTimeToUtc(2026, 0, 5, 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-01-05T14:00:00.000Z',
    );
    // 09:00 EDT (July, DST) = 13:00 UTC
    expect(zonedWallTimeToUtc(2026, 6, 6, 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-07-06T13:00:00.000Z',
    );
  });
});

describe('availableSlots', () => {
  const monday = new Date('2026-01-05T00:00:00Z');

  it('lays out duration-sized slots inside a window', () => {
    const slots = availableSlots({
      rules: [{ weekday: 1, start: 9 * 60, end: 11 * 60 }],
      durationMinutes: 30,
      bufferMinutes: 0,
      timeZone: 'UTC',
      fromDate: monday,
      days: 1,
      bookedStarts: [],
      now: past,
    });
    expect(slots.map((s) => s.toISOString())).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-05T09:30:00.000Z',
      '2026-01-05T10:00:00.000Z',
      '2026-01-05T10:30:00.000Z',
    ]);
  });

  it('steps by duration + buffer', () => {
    const slots = availableSlots({
      rules: [{ weekday: 1, start: 9 * 60, end: 11 * 60 }],
      durationMinutes: 30,
      bufferMinutes: 30,
      timeZone: 'UTC',
      fromDate: monday,
      days: 1,
      bookedStarts: [],
      now: past,
    });
    expect(slots.map((s) => s.toISOString())).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-05T10:00:00.000Z',
    ]);
  });

  it('only emits slots on matching weekdays', () => {
    const query = {
      rules: [{ weekday: 2, start: 9 * 60, end: 10 * 60 }],
      durationMinutes: 30,
      bufferMinutes: 0,
      timeZone: 'UTC',
      fromDate: monday,
      bookedStarts: [],
      now: past,
    };
    expect(availableSlots({ ...query, days: 1 })).toHaveLength(0); // Monday only
    expect(availableSlots({ ...query, days: 2 })).toHaveLength(2); // includes Tuesday
  });

  it('excludes booked and past slots', () => {
    const base = {
      rules: [{ weekday: 1, start: 9 * 60, end: 11 * 60 }],
      durationMinutes: 30,
      bufferMinutes: 0,
      timeZone: 'UTC',
      fromDate: monday,
      days: 1,
    };
    const booked = availableSlots({
      ...base,
      bookedStarts: [Date.parse('2026-01-05T09:30:00.000Z')],
      now: past,
    });
    expect(booked.map((s) => s.toISOString())).not.toContain('2026-01-05T09:30:00.000Z');
    expect(booked).toHaveLength(3);

    const future = availableSlots({
      ...base,
      bookedStarts: [],
      now: new Date('2026-01-05T10:00:00Z'),
    });
    expect(future.map((s) => s.toISOString())).toEqual(['2026-01-05T10:30:00.000Z']);
  });

  it('computes slots in the page timezone', () => {
    const slots = availableSlots({
      rules: [{ weekday: 1, start: 9 * 60, end: 10 * 60 }],
      durationMinutes: 30,
      bufferMinutes: 0,
      timeZone: 'America/New_York',
      // noon UTC is still Monday morning in New York
      fromDate: new Date('2026-01-05T12:00:00Z'),
      days: 1,
      bookedStarts: [],
      now: past,
    });
    expect(slots.map((s) => s.toISOString())).toEqual([
      '2026-01-05T14:00:00.000Z',
      '2026-01-05T14:30:00.000Z',
    ]);
  });
});

describe('availability schema & helpers', () => {
  it('validates rules and rejects inverted windows', () => {
    expect(availabilitySchema.safeParse(DEFAULT_AVAILABILITY).success).toBe(true);
    expect(availabilitySchema.safeParse([{ weekday: 1, start: 600, end: 540 }]).success).toBe(
      false,
    );
    expect(availabilitySchema.safeParse([{ weekday: 7, start: 0, end: 60 }]).success).toBe(false);
  });

  it('recognises valid IANA timezones', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});
