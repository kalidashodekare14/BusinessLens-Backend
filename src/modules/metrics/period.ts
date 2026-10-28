/**
 * Analysis period math (TASKS.md T4.1, PROJECT_ARCHITECTURE.md §9.1).
 *
 * Everything is UTC. We deliberately avoid local-time accessors and date
 * libraries: adding fixed 24-hour steps in UTC keeps the windows DST-free and
 * identical on every machine.
 *
 * Conventions:
 * - `referenceDate` is UTC midnight of the latest non-excluded order's day.
 * - `currentEnd` / `previousEnd` are the *inclusive* last days of each period.
 * - SQL uses half-open ranges via `currentRange` / `previousRange`, so the
 *   inclusive day is never queried as `<=` and can never include the next day.
 */

export const PERIOD_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface AnalysisPeriods {
  referenceDate: Date;
  /** First day of the current 30-day period (inclusive). */
  currentStart: Date;
  /** Last day of the current period (inclusive, UTC midnight). */
  currentEnd: Date;
  /** First day of the previous 30-day period (inclusive). */
  previousStart: Date;
  /** Last day of the previous period (inclusive, UTC midnight). */
  previousEnd: Date;
}

export interface DateRange {
  gte: Date;
  lt: Date;
}

/** UTC midnight of the given instant. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Adds whole UTC days without touching local time. */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Resolves both windows from the timestamp of the latest non-excluded order.
 * The caller is responsible for excluding cancelled/refunded/voided orders
 * before choosing that timestamp.
 */
export function resolveAnalysisPeriods(latestOrderAt: Date): AnalysisPeriods {
  if (Number.isNaN(latestOrderAt.getTime())) {
    throw new RangeError('latestOrderAt must be a valid date');
  }

  const referenceDate = startOfUtcDay(latestOrderAt);
  // 30 days ending on the reference day: reference - 29 .. reference.
  const currentStart = addUtcDays(referenceDate, -(PERIOD_DAYS - 1));
  // The 30 days immediately before the current period.
  const previousStart = addUtcDays(currentStart, -PERIOD_DAYS);
  const previousEnd = addUtcDays(currentStart, -1);

  return {
    referenceDate,
    currentStart,
    currentEnd: referenceDate,
    previousStart,
    previousEnd,
  };
}

/** [currentStart, referenceDate + 1 day) — start inclusive, end exclusive. */
export function currentRange(periods: AnalysisPeriods): DateRange {
  return { gte: periods.currentStart, lt: addUtcDays(periods.currentEnd, 1) };
}

/** [previousStart, currentStart) — start inclusive, end exclusive. */
export function previousRange(periods: AnalysisPeriods): DateRange {
  return { gte: periods.previousStart, lt: addUtcDays(periods.previousEnd, 1) };
}
