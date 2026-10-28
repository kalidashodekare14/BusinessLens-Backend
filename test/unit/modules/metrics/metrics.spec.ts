import { Prisma } from '../../../../src/generated/prisma/client';
import { displayPercent, percentChange } from '../../../../src/modules/metrics/change';
import {
  metricsChanges,
  serializeMetricsSnapshot,
  serializePeriodMetrics,
  type OrganizationMetrics,
  type PeriodMetrics,
} from '../../../../src/modules/metrics/metrics.types';

const decimal = (value: string | number) => new Prisma.Decimal(value);

function period(overrides: Partial<PeriodMetrics> = {}): PeriodMetrics {
  return {
    start: new Date('2026-09-01T00:00:00.000Z'),
    end: new Date('2026-09-30T00:00:00.000Z'),
    revenue: decimal('26705.50'),
    orderCount: 201,
    averageOrderValue: decimal('132.86'),
    products: [
      {
        productId: 'product-1',
        name: 'Widget',
        revenue: decimal('120.00'),
        units: 12,
      },
    ],
    ...overrides,
  };
}

function metrics(overrides: Partial<OrganizationMetrics> = {}): OrganizationMetrics {
  return {
    referenceDate: new Date('2026-09-30T00:00:00.000Z'),
    current: period(),
    previous: period({
      start: new Date('2026-08-02T00:00:00.000Z'),
      end: new Date('2026-08-31T00:00:00.000Z'),
      revenue: decimal('39489.50'),
      orderCount: 281,
      averageOrderValue: decimal('140.53'),
    }),
    ...overrides,
  };
}

describe('percentChange', () => {
  it('computes the exact change from Decimal values', () => {
    expect(percentChange(decimal('80'), decimal('100'))?.toFixed(10)).toBe('-20.0000000000');
    expect(percentChange(decimal('90.01'), decimal('100'))?.toFixed(10)).toBe('-9.9900000000');
  });

  it('returns null when the previous value is zero', () => {
    expect(percentChange(decimal('100'), decimal('0'))).toBeNull();
  });

  it('does not round before the caller compares it to a threshold', () => {
    const change = percentChange(decimal('79.996'), decimal('100'));
    expect(change?.toFixed(6)).toBe('-20.004000');
    expect(displayPercent(change as Prisma.Decimal)).toBe(-20);
  });
});

describe('displayPercent', () => {
  it('rounds to one decimal place, half away from zero', () => {
    expect(displayPercent(decimal('-32.37316248623052'))).toBe(-32.4);
    expect(displayPercent(decimal('-20.04'))).toBe(-20);
    expect(displayPercent(decimal('-20.05'))).toBe(-20.1);
    expect(displayPercent(decimal('0'))).toBe(0);
  });
});

describe('metrics serialization', () => {
  it('writes money as two-decimal strings and dates as ISO UTC', () => {
    expect(serializePeriodMetrics(period())).toEqual({
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-30T00:00:00.000Z',
      revenue: '26705.50',
      orderCount: 201,
      averageOrderValue: '132.86',
      products: [
        {
          productId: 'product-1',
          name: 'Widget',
          revenue: '120.00',
          units: 12,
        },
      ],
    });
  });

  it('serializes the snapshot used by the analysis run', () => {
    const snapshot = serializeMetricsSnapshot(metrics());

    expect(snapshot.version).toBe(1);
    expect(snapshot.referenceDate).toBe('2026-09-30T00:00:00.000Z');
    expect(snapshot.current.revenue).toBe('26705.50');
    expect(snapshot.previous.revenue).toBe('39489.50');
  });

  it('computes display changes from exact values', () => {
    expect(metricsChanges(metrics())).toEqual({
      revenue: -32.4,
      orderCount: -28.5,
      averageOrderValue: -5.5,
    });
  });

  it('returns null changes when the previous period has no value', () => {
    const empty = period({ revenue: decimal(0), orderCount: 0, averageOrderValue: decimal(0) });
    expect(metricsChanges(metrics({ previous: empty }))).toEqual({
      revenue: null,
      orderCount: null,
      averageOrderValue: null,
    });
  });
});
