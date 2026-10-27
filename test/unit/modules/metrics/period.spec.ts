import {
  addUtcDays,
  currentRange,
  DAY_MS,
  PERIOD_DAYS,
  previousRange,
  resolveAnalysisPeriods,
  startOfUtcDay,
} from '../../../../src/modules/metrics/period';

function iso(date: Date): string {
  return date.toISOString();
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

describe('analysis period utility', () => {
  describe('startOfUtcDay', () => {
    it('keeps UTC midnight unchanged', () => {
      expect(iso(startOfUtcDay(new Date('2026-09-30T00:00:00.000Z')))).toBe(
        '2026-09-30T00:00:00.000Z',
      );
    });

    it('floors a late timestamps to the same UTC day', () => {
      expect(iso(startOfUtcDay(new Date('2026-09-30T23:59:59.999Z')))).toBe(
        '2026-09-30T00:00:00.000Z',
      );
    });

    it('uses the UTC day even when local time differs', () => {
      // 00:30 UTC on Jan 1 is still Dec 31 in negative-offset zones; UTC must win.
      expect(iso(startOfUtcDay(new Date('2026-01-01T00:30:00.000Z')))).toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });
  });

  describe('addUtcDays', () => {
    it('crosses month and year boundaries', () => {
      expect(iso(addUtcDays(new Date('2026-12-31T00:00:00.000Z'), 1))).toBe(
        '2027-01-01T00:00:00.000Z',
      );
      expect(iso(addUtcDays(new Date('2026-03-01T00:00:00.000Z'), -1))).toBe(
        '2026-02-28T00:00:00.000Z',
      );
    });

    it('handles a leap day', () => {
      expect(iso(addUtcDays(new Date('2028-02-28T00:00:00.000Z'), 1))).toBe(
        '2028-02-29T00:00:00.000Z',
      );
      expect(iso(addUtcDays(new Date('2028-03-01T00:00:00.000Z'), -1))).toBe(
        '2028-02-29T00:00:00.000Z',
      );
    });

    it('is unaffected by DST transitions because it works in UTC', () => {
      // US DST starts 2026-03-08 and ends 2026-11-01; both steps must be 24h.
      for (const date of ['2026-03-07T00:00:00.000Z', '2026-10-31T00:00:00.000Z']) {
        expect(daysBetween(new Date(date), addUtcDays(new Date(date), 1))).toBe(1);
      }
    });
  });

  describe('resolveAnalysisPeriods', () => {
    it('resolves 30-day current and previous windows ending on the reference day', () => {
      const periods = resolveAnalysisPeriods(new Date('2026-09-30T17:45:00.000Z'));

      expect(iso(periods.referenceDate)).toBe('2026-09-30T00:00:00.000Z');
      expect(iso(periods.currentStart)).toBe('2026-09-01T00:00:00.000Z');
      expect(iso(periods.currentEnd)).toBe('2026-09-30T00:00:00.000Z');
      expect(iso(periods.previousStart)).toBe('2026-08-02T00:00:00.000Z');
      expect(iso(periods.previousEnd)).toBe('2026-08-31T00:00:00.000Z');
    });

    it('makes the periods contiguous, non-overlapping and exactly 30 days each', () => {
      const periods = resolveAnalysisPeriods(new Date('2026-09-30T08:00:00.000Z'));

      expect(daysBetween(periods.currentStart, addUtcDays(periods.currentEnd, 1))).toBe(
        PERIOD_DAYS,
      );
      expect(daysBetween(periods.previousStart, addUtcDays(periods.previousEnd, 1))).toBe(
        PERIOD_DAYS,
      );
      expect(iso(addUtcDays(periods.currentStart, -1))).toBe(iso(periods.previousEnd));
      expect(iso(periods.previousEnd)).not.toBe(iso(periods.currentStart));
    });

    it('crosses a month boundary', () => {
      const periods = resolveAnalysisPeriods(new Date('2026-03-05T10:00:00.000Z'));

      expect(iso(periods.currentStart)).toBe('2026-02-04T00:00:00.000Z');
      expect(iso(periods.currentEnd)).toBe('2026-03-05T00:00:00.000Z');
      expect(iso(periods.previousStart)).toBe('2026-01-05T00:00:00.000Z');
      expect(iso(periods.previousEnd)).toBe('2026-02-03T00:00:00.000Z');
    });

    it('crosses a year boundary', () => {
      const periods = resolveAnalysisPeriods(new Date('2027-01-01T00:00:00.000Z'));

      expect(iso(periods.currentStart)).toBe('2026-12-03T00:00:00.000Z');
      expect(iso(periods.previousStart)).toBe('2026-11-03T00:00:00.000Z');
      expect(iso(periods.previousEnd)).toBe('2026-12-02T00:00:00.000Z');
    });

    it('includes the reference day and excludes the following day in SQL ranges', () => {
      const periods = resolveAnalysisPeriods(new Date('2026-02-28T23:59:59.999Z'));

      expect(currentRange(periods)).toEqual({
        gte: new Date('2026-01-30T00:00:00.000Z'),
        lt: new Date('2026-03-01T00:00:00.000Z'),
      });
      expect(previousRange(periods)).toEqual({
        gte: new Date('2025-12-31T00:00:00.000Z'),
        lt: new Date('2026-01-30T00:00:00.000Z'),
      });
    });

    it('rejects an invalid date', () => {
      expect(() => resolveAnalysisPeriods(new Date('not-a-date'))).toThrow(RangeError);
    });
  });
});
