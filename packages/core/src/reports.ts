/**
 * Pure date-series helpers for the admin reports (G4). Postgres rows come
 * back as bare timestamps; these shape them into dense, ordered series the
 * charts can render — gaps filled with zeros, keys stable for CSV export.
 */

/** UTC day key: '2026-06-11'. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last `days` day-keys, ascending, ending today (UTC). */
export function dayKeys(days: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(dayKey(new Date(end - i * 86_400_000)));
  }
  return keys;
}

/** Count timestamps per day key. */
export function countByDay(dates: Date[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = dayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Dense series over the keys — every day present, zeros filled. */
export function fillDailySeries(
  keys: string[],
  counts: Map<string, number>,
): Array<{ day: string; count: number }> {
  return keys.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}

/** Merge several named daily series over shared keys (chart-ready rows). */
export function mergeDailySeries(
  keys: string[],
  series: Record<string, Map<string, number>>,
): Array<Record<string, string | number>> {
  return keys.map((day) => {
    const row: Record<string, string | number> = { day };
    for (const [name, counts] of Object.entries(series)) {
      row[name] = counts.get(day) ?? 0;
    }
    return row;
  });
}
