import { Prisma } from '../../../../src/generated/prisma/client';
import {
  containsControlCharacters,
  parseNonNegativeMoney,
  parseOrderedAt,
  parsePositiveInteger,
} from '../../../../src/modules/imports/csv/value-parsers';

describe('parseOrderedAt', () => {
  it.each([
    ['2026-01-01', '2026-01-01T00:00:00.000Z'],
    [' 2026-01-01 ', '2026-01-01T00:00:00.000Z'],
    ['2024-02-29', '2024-02-29T00:00:00.000Z'],
    ['2026-01-01T10:30:00Z', '2026-01-01T10:30:00.000Z'],
    ['2026-01-01t10:30:00z', '2026-01-01T10:30:00.000Z'],
    ['2026-01-01 10:30:00', '2026-01-01T10:30:00.000Z'],
    ['2026-01-01T10:30', '2026-01-01T10:30:00.000Z'],
    ['2026-01-01T10:30:00.5Z', '2026-01-01T10:30:00.500Z'],
    ['2026-01-01T10:30:00.123Z', '2026-01-01T10:30:00.123Z'],
    ['2026-01-01T10:30:00+02:00', '2026-01-01T08:30:00.000Z'],
    ['2026-01-01T10:30:00-05:00', '2026-01-01T15:30:00.000Z'],
    ['2026-01-01T00:30:00+02:00', '2025-12-31T22:30:00.000Z'],
  ])('parses %s as %s', (input, expected) => {
    expect(parseOrderedAt(input)?.toISOString()).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '2026-13-01',
    '2026-00-10',
    '2026-01-32',
    '2026-02-30',
    '2026-02-29',
    '2026-1-1',
    '01/02/2026',
    '2026-01-01T24:00:00Z',
    '2026-01-01T10:60:00Z',
    '2026-01-01T10:30:60Z',
    '2026-01-01T10:30:00+24:00',
    '2026-01-01T10:30:00+02:60',
    '2026-01-01T10:30:00.1234Z',
    'not a date',
  ])('rejects %s', (input) => {
    expect(parseOrderedAt(input)).toBeNull();
  });
});

describe('parsePositiveInteger', () => {
  it.each([
    ['1', 1],
    ['007', 7],
    [' 42 ', 42],
    ['2147483647', 2147483647],
  ])('parses %s as %s', (input, expected) => {
    expect(parsePositiveInteger(input)).toBe(expected);
  });

  it.each(['', '   ', '0', '-1', '1.0', '1e3', '+2', 'abc', '2147483648', '999999999999999999999'])(
    'rejects %s',
    (input) => {
      expect(parsePositiveInteger(input)).toBeNull();
    },
  );
});

describe('parseNonNegativeMoney', () => {
  it.each([
    ['0', '0.00'],
    ['0.00', '0.00'],
    ['19.99', '19.99'],
    ['007.5', '7.50'],
    ['9999999999.99', '9999999999.99'],
  ])('parses %s exactly', (input, expected) => {
    const parsed = parseNonNegativeMoney(input);
    expect(parsed).toBeInstanceOf(Prisma.Decimal);
    expect(parsed?.toFixed(2)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '-0.01',
    '1.234',
    '1e3',
    '1,000.00',
    '.99',
    '1.',
    'abc',
    '+1.00',
    '10000000000.00',
  ])('rejects %s', (input) => {
    expect(parseNonNegativeMoney(input)).toBeNull();
  });
});

describe('containsControlCharacters', () => {
  it.each(['Hello World', 'Café', 'a b c', '2026-01-01'])('accepts %s', (input) => {
    expect(containsControlCharacters(input)).toBe(false);
  });

  it.each(['a\tb', 'a\nb', 'a\rb', 'a\u0000b', 'a\u007fb'])('rejects %s', (input) => {
    expect(containsControlCharacters(input)).toBe(true);
  });
});
