import type { Prisma } from '../../../../src/generated/prisma/client';
import { DashboardService } from '../../../../src/modules/dashboard/dashboard.service';

type GroupByRow = { severity: 'MEDIUM' | 'HIGH'; _count: { _all: number } };

function buildTx(options: {
  severityCounts?: GroupByRow[];
  latestRun?: Record<string, unknown> | null;
  /** Captures the arguments groupBy was called with, for where-clause checks. */
  onGroupBy?: (args: Record<string, unknown>) => void;
}) {
  return {
    finding: {
      groupBy: jest.fn((args: Record<string, unknown>) => {
        options.onGroupBy?.(args);
        return Promise.resolve(options.severityCounts ?? []);
      }),
    },
    analysisRun: {
      findFirst: jest.fn(() => Promise.resolve(options.latestRun ?? null)),
    },
  } as unknown as Prisma.TransactionClient;
}

function buildService(tx: Prisma.TransactionClient): DashboardService {
  const tenantPrisma = {
    run: (_organizationId: string, fn: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      fn(tx),
  } as never;
  return new DashboardService(tenantPrisma);
}

const SNAPSHOT = {
  version: 1,
  referenceDate: '2026-09-30T00:00:00.000Z',
  current: {
    start: 'x',
    end: 'y',
    revenue: '80.00',
    orderCount: 10,
    averageOrderValue: '8.00',
    products: [],
  },
  previous: {
    start: 'x',
    end: 'y',
    revenue: '100.00',
    orderCount: 20,
    averageOrderValue: '5.00',
    products: [],
  },
};

describe('DashboardService', () => {
  it('returns zeros and nulls for an organization with no data', async () => {
    const service = buildService(buildTx({}));

    const dashboard = await service.get('org-1');

    expect(dashboard).toEqual({
      openFindings: { total: 0, bySeverity: { MEDIUM: 0, HIGH: 0 } },
      latestAnalysisRun: null,
      metrics: null,
    });
  });

  it('counts only non-resolved findings, grouped by severity', async () => {
    let capturedWhere: Record<string, unknown> | undefined;
    const tx = buildTx({
      severityCounts: [
        { severity: 'HIGH', _count: { _all: 2 } },
        { severity: 'MEDIUM', _count: { _all: 1 } },
      ],
      onGroupBy: (args) => {
        capturedWhere = args.where as Record<string, unknown>;
      },
    });

    const dashboard = await buildService(tx).get('org-1');

    expect(dashboard.openFindings).toEqual({
      total: 3,
      bySeverity: { HIGH: 2, MEDIUM: 1 },
    });
    expect(capturedWhere).toEqual({
      organizationId: 'org-1',
      status: { in: ['OPEN', 'INVESTIGATING'] },
    });
  });

  it('exposes the latest run and its key metrics with changes', async () => {
    const latestRun = {
      id: 'run-1',
      status: 'COMPLETED',
      referenceDate: new Date('2026-09-30T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      completedAt: new Date('2026-10-01T00:01:00.000Z'),
      metricsSnapshot: SNAPSHOT,
    };

    const dashboard = await buildService(buildTx({ latestRun })).get('org-1');

    expect(dashboard.latestAnalysisRun).toEqual({
      id: 'run-1',
      status: 'COMPLETED',
      referenceDate: new Date('2026-09-30T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      completedAt: new Date('2026-10-01T00:01:00.000Z'),
    });
    expect(dashboard.metrics).toEqual({
      referenceDate: '2026-09-30T00:00:00.000Z',
      revenue: { current: '80.00', previous: '100.00', changePercent: -20 },
      orderCount: { current: 10, previous: 20, changePercent: -50 },
      averageOrderValue: { current: '8.00', previous: '5.00', changePercent: 60 },
    });
  });

  it('keeps the run visible when its snapshot is missing or unrecognizable', async () => {
    const base = {
      id: 'run-2',
      status: 'FAILED',
      referenceDate: null,
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      completedAt: null,
    };

    const withoutSnapshot = await buildService(
      buildTx({ latestRun: { ...base, metricsSnapshot: null } }),
    ).get('org-1');
    expect(withoutSnapshot.latestAnalysisRun).toMatchObject({ id: 'run-2', status: 'FAILED' });
    expect(withoutSnapshot.metrics).toBeNull();

    const badSnapshot = await buildService(
      buildTx({ latestRun: { ...base, metricsSnapshot: { version: 99 } } }),
    ).get('org-1');
    expect(badSnapshot.metrics).toBeNull();
  });

  it('reports a null change when the previous value is zero', async () => {
    const latestRun = {
      id: 'run-3',
      status: 'COMPLETED',
      referenceDate: null,
      createdAt: new Date('2026-10-03T00:00:00.000Z'),
      completedAt: null,
      metricsSnapshot: {
        version: 1,
        referenceDate: '2026-09-30T00:00:00.000Z',
        current: { revenue: '0.00', orderCount: 0, averageOrderValue: '0.00' },
        previous: { revenue: '0.00', orderCount: 0, averageOrderValue: '0.00' },
      },
    };

    const dashboard = await buildService(buildTx({ latestRun })).get('org-1');

    expect(dashboard.metrics?.revenue.changePercent).toBeNull();
    expect(dashboard.metrics?.orderCount.changePercent).toBeNull();
    expect(dashboard.metrics?.averageOrderValue.changePercent).toBeNull();
  });
});
