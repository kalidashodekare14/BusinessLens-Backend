import { Prisma } from '../../generated/prisma/client';

/**
 * Exact percentage change: (current - previous) / previous * 100.
 * Returns null when the previous value is zero, because the percentage is
 * undefined (§9.3 guard). Never round before comparing against thresholds.
 */
export function percentChange(
  current: Prisma.Decimal,
  previous: Prisma.Decimal,
): Prisma.Decimal | null {
  if (previous.isZero()) {
    return null;
  }
  return current.minus(previous).div(previous).times(100);
}

/**
 * Display value: one decimal place. Decimal.js defaults to ROUND_HALF_UP, which
 * matches the spec's "rounded to 1 decimal for display". Use only for display and
 * evidence; trigger and severity decisions use the exact value.
 */
export function displayPercent(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(1).toNumber();
}
