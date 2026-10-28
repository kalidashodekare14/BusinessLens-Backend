import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma, type AnalysisStatus, type Severity } from '../../generated/prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { displayPercent, percentChange } from '../metrics/change';

export interface DashboardMoneyView {
  current: string;
  previous: string;
  changePercent: number | null;
}

export interface DashboardCountView {
  current: number;
  previous: number;
  changePercent: number | null;
}

export interface DashboardMetricsView {
  referenceDate: string;
  revenue: DashboardMoneyView;
  orderCount: DashboardCountView;
  averageOrderValue: DashboardMoneyView;
}

export interface DashboardRunView {
  id: string;
  status: AnalysisStatus;
  referenceDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface DashboardView {
  /** Findings that still need attention: OPEN + INVESTIGATING (§11). */
  openFindings: {
    total: number;
    bySeverity: Record<Severity, number>;
  };
  latestAnalysisRun: DashboardRunView | null;
  /** Key metrics taken from the latest run's snapshot; null without one. */
  metrics: DashboardMetricsView | null;
}

/**
 * The slice of `AnalysisRun.metricsSnapshot` the dashboard shows. Written by
 * our own serializer, but parsed defensively: an unknown or older snapshot
 * degrades to `metrics: null` instead of breaking the dashboard.
 */
const periodSchema = z.object({
  revenue: z.string().regex(/^[-+]?\d+(?:\.\d+)?$/),
  orderCount: z.number().int().nonnegative(),
  averageOrderValue: z.string().regex(/^[-+]?\d+(?:\.\d+)?$/),
});

const snapshotSchema = z.object({
  version: z.literal(1),
  referenceDate: z.string(),
  current: periodSchema,
  previous: periodSchema,
});

function decimalChangePercent(current: string, previous: string): number | null {
  const change = percentChange(new Prisma.Decimal(current), new Prisma.Decimal(previous));
  return change === null ? null : displayPercent(change);
}

function countChangePercent(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  const change = percentChange(new Prisma.Decimal(current), new Prisma.Decimal(previous));
  return change === null ? null : displayPercent(change);
}

function toMetricsView(snapshot: Prisma.JsonValue): DashboardMetricsView | null {
  if (snapshot === null) {
    return null;
  }
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return null;
  }
  const { referenceDate, current, previous } = parsed.data;
  return {
    referenceDate,
    revenue: {
      current: current.revenue,
      previous: previous.revenue,
      changePercent: decimalChangePercent(current.revenue, previous.revenue),
    },
    orderCount: {
      current: current.orderCount,
      previous: previous.orderCount,
      changePercent: countChangePercent(current.orderCount, previous.orderCount),
    },
    averageOrderValue: {
      current: current.averageOrderValue,
      previous: previous.averageOrderValue,
      changePercent: decimalChangePercent(current.averageOrderValue, previous.averageOrderValue),
    },
  };
}

@Injectable()
export class DashboardService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async get(organizationId: string): Promise<DashboardView> {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const [severityCounts, latestRun] = await Promise.all([
        tx.finding.groupBy({
          by: ['severity'],
          where: { organizationId, status: { in: ['OPEN', 'INVESTIGATING'] } },
          _count: { _all: true },
        }),
        tx.analysisRun.findFirst({
          where: { organizationId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            status: true,
            referenceDate: true,
            createdAt: true,
            completedAt: true,
            metricsSnapshot: true,
          },
        }),
      ]);

      const bySeverity: Record<Severity, number> = { MEDIUM: 0, HIGH: 0 };
      let total = 0;
      for (const row of severityCounts) {
        bySeverity[row.severity] = row._count._all;
        total += row._count._all;
      }

      return {
        openFindings: { total, bySeverity },
        latestAnalysisRun:
          latestRun === null
            ? null
            : {
                id: latestRun.id,
                status: latestRun.status,
                referenceDate: latestRun.referenceDate,
                createdAt: latestRun.createdAt,
                completedAt: latestRun.completedAt,
              },
        metrics: latestRun === null ? null : toMetricsView(latestRun.metricsSnapshot),
      };
    });
  }
}
