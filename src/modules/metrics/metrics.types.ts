import { Prisma } from '../../generated/prisma/client';
import { displayPercent, percentChange } from './change';

/**
 * Domain metrics use `Decimal` throughout so money and percentages stay exact
 * (AGENT.md: never JavaScript floats). Serialization to the API/snapshot is the
 * only place values become strings/numbers.
 */
export interface ProductMetrics {
  productId: string | null;
  name: string;
  revenue: Prisma.Decimal;
  units: number;
}

export interface PeriodMetrics {
  /** First day of the period, inclusive, UTC midnight. */
  start: Date;
  /** Last day of the period, inclusive, UTC midnight. */
  end: Date;
  revenue: Prisma.Decimal;
  orderCount: number;
  averageOrderValue: Prisma.Decimal;
  products: ProductMetrics[];
}

export interface OrganizationMetrics {
  referenceDate: Date;
  current: PeriodMetrics;
  previous: PeriodMetrics;
}

export interface ProductMetricsView {
  productId: string | null;
  name: string;
  /** Money is a string in JSON (§12). */
  revenue: string;
  units: number;
}

export interface PeriodMetricsView {
  /** ISO 8601 UTC. */
  start: string;
  /** ISO 8601 UTC, inclusive last day. */
  end: string;
  revenue: string;
  orderCount: number;
  averageOrderValue: string;
  products: ProductMetricsView[];
}

export interface MetricsSnapshot {
  version: 1;
  referenceDate: string;
  current: PeriodMetricsView;
  previous: PeriodMetricsView;
}

export interface MetricsChangesView {
  revenue: number | null;
  orderCount: number | null;
  averageOrderValue: number | null;
}

export interface MetricsOverviewView {
  referenceDate: string;
  current: PeriodMetricsView;
  previous: PeriodMetricsView;
  changes: MetricsChangesView;
}

export function serializePeriodMetrics(period: PeriodMetrics): PeriodMetricsView {
  return {
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    revenue: period.revenue.toFixed(2),
    orderCount: period.orderCount,
    averageOrderValue: period.averageOrderValue.toFixed(2),
    products: period.products.map((product) => ({
      productId: product.productId,
      name: product.name,
      revenue: product.revenue.toFixed(2),
      units: product.units,
    })),
  };
}

export function serializeMetricsSnapshot(metrics: OrganizationMetrics): MetricsSnapshot {
  return {
    version: 1,
    referenceDate: metrics.referenceDate.toISOString(),
    current: serializePeriodMetrics(metrics.current),
    previous: serializePeriodMetrics(metrics.previous),
  };
}

/** Display-only changes; null when the previous value is zero. */
export function metricsChanges(metrics: OrganizationMetrics): MetricsChangesView {
  const revenue = percentChange(metrics.current.revenue, metrics.previous.revenue);
  const averageOrderValue = percentChange(
    metrics.current.averageOrderValue,
    metrics.previous.averageOrderValue,
  );
  const orderCount =
    metrics.previous.orderCount === 0
      ? null
      : new Prisma.Decimal(metrics.current.orderCount)
          .minus(metrics.previous.orderCount)
          .div(metrics.previous.orderCount)
          .times(100);

  return {
    revenue: revenue === null ? null : displayPercent(revenue),
    orderCount: orderCount === null ? null : displayPercent(orderCount),
    averageOrderValue: averageOrderValue === null ? null : displayPercent(averageOrderValue),
  };
}
