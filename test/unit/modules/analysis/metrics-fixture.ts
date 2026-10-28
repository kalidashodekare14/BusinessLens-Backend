import { Prisma } from '../../../../src/generated/prisma/client';
import type {
  OrganizationMetrics,
  PeriodMetrics,
  ProductMetrics,
} from '../../../../src/modules/metrics/metrics.types';

export const CURRENT_START = new Date('2026-09-01T00:00:00.000Z');
export const CURRENT_END = new Date('2026-09-30T00:00:00.000Z');
export const PREVIOUS_START = new Date('2026-08-02T00:00:00.000Z');
export const PREVIOUS_END = new Date('2026-08-31T00:00:00.000Z');

export interface PeriodOverrides {
  revenue?: string | number;
  orderCount?: number;
  averageOrderValue?: string | number;
  products?: ProductMetrics[];
}

export interface MetricsOverrides {
  current?: PeriodOverrides;
  previous?: PeriodOverrides;
}

export function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function product(
  name: string,
  revenue: string | number,
  options: { productId?: string | null; units?: number } = {},
): ProductMetrics {
  return {
    productId: options.productId === undefined ? `id-${name}` : options.productId,
    name,
    revenue: decimal(revenue),
    units: options.units ?? 1,
  };
}

function period(overrides: PeriodOverrides, start: Date, end: Date): PeriodMetrics {
  const orderCount = overrides.orderCount ?? 25;
  const revenue = decimal(overrides.revenue ?? '100');
  const averageOrderValue =
    overrides.averageOrderValue !== undefined
      ? decimal(overrides.averageOrderValue)
      : orderCount === 0
        ? decimal(0)
        : revenue.div(orderCount).toDecimalPlaces(2);

  return {
    start,
    end,
    revenue,
    orderCount,
    averageOrderValue,
    products: overrides.products ?? [],
  };
}

export function buildMetrics(overrides: MetricsOverrides = {}): OrganizationMetrics {
  return {
    referenceDate: CURRENT_END,
    current: period(overrides.current ?? {}, CURRENT_START, CURRENT_END),
    previous: period(overrides.previous ?? {}, PREVIOUS_START, PREVIOUS_END),
  };
}
