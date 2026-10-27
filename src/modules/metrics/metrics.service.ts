import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { EXCLUDED_ORDER_STATUSES } from './order-statuses';
import { currentRange, previousRange, resolveAnalysisPeriods, type DateRange } from './period';
import {
  metricsChanges,
  serializeMetricsSnapshot,
  type MetricsOverviewView,
  type OrganizationMetrics,
  type PeriodMetrics,
  type ProductMetrics,
} from './metrics.types';

interface PeriodSummaryRow {
  orderCount: number;
  /** numeric is returned as text so every value goes through Decimal, never a float. */
  revenue: string | null;
}

interface ProductSummaryRow {
  productId: string | null;
  name: string;
  revenue: string | null;
  units: number;
}

/**
 * Deterministic metric computation (§9.2). Used by the metrics endpoint and by
 * the analysis worker, so both always report identical numbers.
 *
 * Raw SQL is used because the spec requires SQL aggregates and because the
 * excluded-status comparison must be case-insensitive. Every query stays inside
 * `TenantPrismaService.run` (the caller's transaction), so RLS applies; the
 * explicit organizationId predicates are defense in depth and use the indexes.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** API path: 422 instead of an empty overview when the organization has no usable orders. */
  async getOverview(organizationId: string): Promise<MetricsOverviewView> {
    const metrics = await this.computeIfAvailable(organizationId);
    if (!metrics) {
      throw apiError(422, 'NO_ORDER_DATA', 'No order data is available for this organization.');
    }

    const snapshot = serializeMetricsSnapshot(metrics);
    return {
      referenceDate: snapshot.referenceDate,
      current: snapshot.current,
      previous: snapshot.previous,
      changes: metricsChanges(metrics),
    };
  }

  /** Returns null when there is no non-excluded order to anchor the periods. */
  async computeIfAvailable(organizationId: string): Promise<OrganizationMetrics | null> {
    return this.tenantPrisma.run(organizationId, (tx) =>
      this.computeWithinTransaction(tx, organizationId),
    );
  }

  /**
   * Computes both periods inside an existing tenant transaction. Callers that need
   * the metrics and their own writes to be atomic (the analysis worker) use this
   * instead of `computeIfAvailable`, which opens its own transaction.
   */
  async computeWithinTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<OrganizationMetrics | null> {
    const latestOrderAt = await this.latestNonExcludedOrderAt(tx, organizationId);
    if (!latestOrderAt) {
      return null;
    }

    const periods = resolveAnalysisPeriods(latestOrderAt);
    const current = await this.summarize(tx, organizationId, currentRange(periods));
    const previous = await this.summarize(tx, organizationId, previousRange(periods));

    return {
      referenceDate: periods.referenceDate,
      current: { ...current, start: periods.currentStart, end: periods.currentEnd },
      previous: { ...previous, start: periods.previousStart, end: periods.previousEnd },
    };
  }

  private async latestNonExcludedOrderAt(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<Date | null> {
    const rows = await tx.$queryRaw<{ latestAt: Date | null }[]>`
      SELECT max(o."orderedAt") AS "latestAt"
      FROM "Order" o
      WHERE o."organizationId" = ${organizationId}
        AND lower(o."status") NOT IN (${Prisma.join([...EXCLUDED_ORDER_STATUSES])})
    `;

    return rows[0]?.latestAt ?? null;
  }

  private async summarize(
    tx: Prisma.TransactionClient,
    organizationId: string,
    range: DateRange,
  ): Promise<Omit<PeriodMetrics, 'start' | 'end'>> {
    const [summary] = await tx.$queryRaw<PeriodSummaryRow[]>`
      SELECT
        count(DISTINCT o.id)::int AS "orderCount",
        coalesce(sum(oi."lineTotal"), 0)::text AS "revenue"
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE o."organizationId" = ${organizationId}
        AND o."orderedAt" >= ${range.gte}
        AND o."orderedAt" < ${range.lt}
        AND lower(o."status") NOT IN (${Prisma.join([...EXCLUDED_ORDER_STATUSES])})
    `;

    const productRows = await tx.$queryRaw<ProductSummaryRow[]>`
      SELECT
        oi."productId" AS "productId",
        oi."productName" AS "name",
        coalesce(sum(oi."lineTotal"), 0)::text AS "revenue",
        sum(oi.quantity)::int AS "units"
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE o."organizationId" = ${organizationId}
        AND o."orderedAt" >= ${range.gte}
        AND o."orderedAt" < ${range.lt}
        AND lower(o."status") NOT IN (${Prisma.join([...EXCLUDED_ORDER_STATUSES])})
      GROUP BY oi."productId", oi."productName"
      ORDER BY sum(oi."lineTotal") DESC, oi."productName" ASC, oi."productId" ASC
    `;

    const orderCount = Number(summary?.orderCount ?? 0);
    const revenue = new Prisma.Decimal(summary?.revenue ?? '0');
    const products: ProductMetrics[] = productRows.map((row) => ({
      productId: row.productId,
      name: row.name,
      revenue: new Prisma.Decimal(row.revenue ?? '0'),
      units: Number(row.units),
    }));

    return {
      revenue,
      orderCount,
      // Zero orders means AOV is not meaningful; expose "0.00" rather than a NaN.
      averageOrderValue:
        orderCount === 0 ? new Prisma.Decimal(0) : revenue.div(orderCount).toDecimalPlaces(2),
      products,
    };
  }
}
