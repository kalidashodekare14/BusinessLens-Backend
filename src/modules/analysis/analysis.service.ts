import { Injectable } from '@nestjs/common';
import type { AnalysisStatus, Prisma } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../queues/queue.constants';
import { QueueService } from '../../queues/queue.service';
import { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';

export interface AnalysisRunCreatedView {
  id: string;
  status: AnalysisStatus;
  createdAt: Date;
}

export interface AnalysisRunListItemView {
  id: string;
  status: AnalysisStatus;
  referenceDate: Date | null;
  currentStart: Date | null;
  currentEnd: Date | null;
  previousStart: Date | null;
  previousEnd: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface AnalysisRunDetailView extends AnalysisRunListItemView {
  metricsSnapshot: Prisma.JsonValue | null;
}

export interface AnalysisRunPage {
  data: AnalysisRunListItemView[];
  meta: { page: number; pageSize: number; total: number };
}

const RUN_LIST_SELECT = {
  id: true,
  status: true,
  referenceDate: true,
  currentStart: true,
  currentEnd: true,
  previousStart: true,
  previousEnd: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
} as const;

@Injectable()
export class AnalysisService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Creates a QUEUED run and enqueues it with a stable job id so a duplicate
   * delivery cannot start a second run. If Redis is unavailable the run is marked
   * FAILED instead of staying QUEUED forever (§12: the client polls status).
   */
  async create(organizationId: string, userId: string): Promise<AnalysisRunCreatedView> {
    const run = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.analysisRun.create({
        data: { organizationId, triggeredById: userId },
        select: { id: true, status: true, createdAt: true },
      }),
    );

    try {
      await this.queue.enqueue(
        QUEUE_NAMES.analysis,
        JOB_NAMES.runAnalysis,
        { organizationId, analysisRunId: run.id },
        { jobId: run.id },
      );
    } catch {
      await this.tenantPrisma
        .run(organizationId, (tx) =>
          tx.analysisRun.updateMany({
            where: { id: run.id, status: 'QUEUED' },
            data: {
              status: 'FAILED',
              errorMessage: 'The analysis could not be queued.',
              completedAt: new Date(),
            },
          }),
        )
        .catch(() => undefined);
      throw apiError(503, 'ANALYSIS_QUEUE_UNAVAILABLE', 'The analysis could not be queued.');
    }

    this.audit.record({
      action: AuditAction.ANALYSIS_STARTED,
      actorId: userId,
      organizationId,
      entityType: 'AnalysisRun',
      entityId: run.id,
    });

    return run;
  }

  async list(organizationId: string, page: number, pageSize: number): Promise<AnalysisRunPage> {
    const { runs, total } = await this.tenantPrisma.run(organizationId, async (tx) => {
      const [runs, total] = await Promise.all([
        tx.analysisRun.findMany({
          where: { organizationId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: RUN_LIST_SELECT,
        }),
        tx.analysisRun.count({ where: { organizationId } }),
      ]);
      return { runs, total };
    });

    return { data: runs, meta: { page, pageSize, total } };
  }

  async get(organizationId: string, runId: string): Promise<AnalysisRunDetailView> {
    const run = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.analysisRun.findUnique({
        where: { id: runId },
        select: { ...RUN_LIST_SELECT, metricsSnapshot: true },
      }),
    );

    if (!run) {
      throw apiError(404, 'NOT_FOUND', 'Analysis run not found.');
    }

    return run;
  }
}
