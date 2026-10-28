import { Prisma } from '../../../generated/prisma/client';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?([Zz]|[+-]\d{2}:\d{2})?$/;
const POSITIVE_INTEGER = /^\d+$/;
// Decimal(12,2) allows 10 integer digits and 2 fractional digits.
const NON_NEGATIVE_MONEY = /^\d{1,10}(?:\.\d{1,2})?$/;
const MAX_INT = 2_147_483_647;

/**
 * CSV imports have no timezone column, so a value without an offset is interpreted
 * as UTC. Dates and datetimes only; ambiguous locale formats are rejected.
 */
export function parseOrderedAt(input: string): Date | null {
  const value = input.trim();

  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    return utcDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 0, 0, 0, 0);
  }

  const match = DATE_TIME.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = '0', fraction = '0', offset] = match;
  const base = utcDate(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, '0')),
  );
  if (!base) {
    return null;
  }
  if (!offset || offset === 'Z' || offset === 'z') {
    return base;
  }

  const sign = offset.startsWith('+') ? 1 : -1;
  const offsetHours = Number(offset.slice(1, 3));
  const offsetMinutes = Number(offset.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) {
    return null;
  }

  return new Date(base.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000);
}

function utcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }
  if (millisecond < 0 || millisecond > 999) {
    return null;
  }

  // setUTCFullYear avoids Date.UTC's 0-99 => 1900-1999 remapping.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);

  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond;

  return valid ? date : null;
}

/** Only decimal digits are accepted; "2.0" is rejected, "007" is 7. */
export function parsePositiveInteger(input: string): number | null {
  const value = input.trim();
  if (!POSITIVE_INTEGER.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_INT) {
    return null;
  }

  return parsed;
}

/**
 * Returns an exact Decimal, never a JavaScript number. More than 2 decimal places
 * are rejected rather than rounded, because persisting a rounded value would
 * change the numbers findings are based on.
 */
export function parseNonNegativeMoney(input: string): Prisma.Decimal | null {
  const value = input.trim();
  if (!NON_NEGATIVE_MONEY.test(value)) {
    return null;
  }

  return new Prisma.Decimal(value);
}

export function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}
