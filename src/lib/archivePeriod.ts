// Period + day-grouping helpers for the Abx Archive page. Pure functions with
// an injected `now` so callers (and tests) never depend on a hidden clock.

import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isSameDay,
  subDays,
} from "date-fns";

export type PeriodKey = "today" | "week" | "month" | "custom";

/** Both bounds are "yyyy-MM-dd" strings, inclusive. */
export type DayRange = { from: string; to: string };

// Johor clinics run a Sunday–Thursday work week; Sunday-start also matches
// date-fns' default, so this is written out to make the choice visible
// rather than silently inherited.
export const WEEK_STARTS_ON = 0 as const;

function toDateStr(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/**
 * Resolve a period selection to an inclusive [from, to] date range.
 * Returns null when nothing is selected yet, or a custom range is missing
 * either endpoint — the caller uses that to keep the data fetch disabled.
 */
export function resolvePeriodRange(
  period: PeriodKey | "",
  now: Date,
  customFrom?: Date,
  customTo?: Date,
): DayRange | null {
  switch (period) {
    case "today": {
      const today = toDateStr(now);
      return { from: today, to: today };
    }
    case "week":
      return {
        from: toDateStr(startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON })),
        to: toDateStr(endOfWeek(now, { weekStartsOn: WEEK_STARTS_ON })),
      };
    case "month":
      return {
        from: toDateStr(startOfMonth(now)),
        to: toDateStr(endOfMonth(now)),
      };
    case "custom": {
      if (!customFrom || !customTo) return null;
      // Users will sometimes pick To before From — swap rather than return
      // an empty/backwards range.
      const [from, to] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
      return { from: toDateStr(from), to: toDateStr(to) };
    }
    default:
      return null;
  }
}

export type DayGroup<T> = { date: string; forms: T[] };

type Groupable = { tarikh: string; acknowledged_at?: string | null };

/**
 * Bucket rows by their raw `tarikh` date string, newest day first. Within a
 * day, rows sort by `acknowledged_at` descending (nulls last).
 */
export function groupByDay<T extends Groupable>(rows: T[]): DayGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.tarikh);
    if (list) list.push(row);
    else map.set(row.tarikh, [row]);
  }

  const groups = Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)) // ISO strings sort chronologically
    .map(([date, forms]) => ({
      date,
      forms: [...forms].sort((a, b) => {
        const aTime = a.acknowledged_at;
        const bTime = b.acknowledged_at;
        if (!aTime && !bTime) return 0;
        if (!aTime) return 1;
        if (!bTime) return -1;
        return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
      }),
    }));

  return groups;
}

/** "Today — Wed, 15 Jul 2026" / "Yesterday — …" / "Mon, 20 Jul 2026". */
export function formatDayLabel(date: string, now: Date): string {
  const d = parseISO(date);
  const dayPart = format(d, "EEE, d MMM yyyy");
  if (isSameDay(d, now)) return `Today — ${dayPart}`;
  if (isSameDay(d, subDays(now, 1))) return `Yesterday — ${dayPart}`;
  return dayPart;
}
