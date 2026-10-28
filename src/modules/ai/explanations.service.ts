import { Injectable } from '@nestjs/common';
import { Prisma, type AiStatus } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../queues/queue.constants';
import { QueueService } from '../../queues/queue.service';
import { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';

export interface ExplanationQueuedView {
  id: string;
  findingId: string;
  status: AiStatus;
  attempts: number;
  updatedAt: Date;
}

@Injectable()
export class ExplanationsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * (Re)queues explanation generation (T5.6, §10): resets the row to PENDING
   * and enqueues a job. The queue gets no custom job id here — unlike the
   * analysis-side enqueue, a regeneration must not dedupe against the job that
   * already completed. If Redis is unavailable the row is left FAILED with a
   * safe message instead of PENDING forever (§12: the client polls status).
   */
  async regenerate(
    organizationId: string,
    findingId: string,
    actorId: string,
  ): Promise<ExplanationQueuedView> {
    const finding = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.finding.findUnique({ where: { id: findingId }, select: { id: true } }),
    );
    if (!finding) {
      throw apiError(404, 'NOT_FOUND', 'Finding not found.');
    }

    const row = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.aiExplanation.upsert({
        where: { findingId },
        create: { organizationId, findingId, status: 'PENDING', attempts: 0 },
        update: {
          status: 'PENDING',
          attempts: 0,
          // DbNull: a discarded explanation keeps no stale content around.
          content: Prisma.DbNull,
          model: null,
          validationPassed: null,
          errorMessage: null,
        },
        select: { id: true, findingId: true, status: true, attempts: true, updatedAt: true },
      }),
    );

    try {
      await this.queue.enqueue(QUEUE_NAMES.aiExplanation, JOB_NAMES.generateExplanation, {
        organizationId,
        findingId,
      });
    } catch {
      await this.tenantPrisma
        .run(organizationId, (tx) =>
          tx.aiExplanation.updateMany({
            where: { findingId, status: 'PENDING' },
            data: {
              status: 'FAILED',
              errorMessage: 'The explanation could not be queued.',
            },
          }),
        )
        .catch(() => undefined);
      throw apiError(503, 'EXPLANATION_QUEUE_UNAVAILABLE', 'The explanation could not be queued.');
    }

    this.audit.record({
      action: AuditAction.EXPLANATION_REGENERATED,
      actorId,
      organizationId,
      entityType: 'Finding',
      entityId: findingId,
    });

    return row;
  }
}
