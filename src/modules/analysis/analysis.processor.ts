import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../queues/queue.constants';
import type { QueueProcessor } from '../../queues/queue-processor';
import { QueueService } from '../../queues/queue.service';
import { TenantJobRunner } from '../../queues/tenant-job-runner';
import { serializeMetricsSnapshot } from '../metrics/metrics.types';
import { MetricsService } from '../metrics/metrics.service';
import { runRules } from './rules/rule.registry';

function readAnalysisRunId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const analysisRunId = (payload as Record<string, unknown>).analysisRunId;
  return typeof analysisRunId === 'string' && isUUID(analysisRunId, '4') ? analysisRunId : null;
}

/** Log only a code or error name: messages may contain data. */
function safeErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Analysis worker (TASKS.md T4.6).
 *
 * The run is claimed with a conditional update so duplicate deliveries are
 * no-ops. Period resolution, metric aggregates, rules and the finding writes all
 * share one tenant transaction, so a failed run never leaves partial findings.
 * AI jobs are enqueued only after that transaction commits; if Redis is down the
 * analysis still stays COMPLETED because the findings are usable.
 */
@Injectable()
export class AnalysisProcessor implements QueueProcessor {
  readonly queue = QUEUE_NAMES.analysis;
  readonly jobName = JOB_NAMES.runAnalysis;
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly tenantJobs: TenantJobRunner,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly metrics: MetricsService,
    private readonly queueService: QueueService,
  ) {}

  async process(job: Job): Promise<void> {
    const organizationId = this.tenantJobs.resolveOrganizationId(job.data);
    const runId = readAnalysisRunId(job.data);
    if (!runId) {
      throw new Error('Job payload is missing a valid analysisRunId.');
    }

    const run = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.analysisRun.findUnique({
        where: { id: runId },
        select: { id: true, status: true },
      }),
    );

    if (!run) {
      // RLS also hides another organization's run from this payload's context.
      throw new Error('Analysis run not found.');
    }
    if (run.status !== 'QUEUED') {
      return;
    }

    const claimed = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.analysisRun.updateMany({
        where: { id: runId, status: 'QUEUED' },
        data: { status: 'RUNNING' },
      }),
    );
    if (claimed.count === 0) {
      // Another delivery claimed the run first.
      return;
    }

    let findingIds: string[];
    try {
      const outcome = await this.tenantPrisma.run(
        organizationId,
        async (tx) => {
          const metrics = await this.metrics.computeWithinTransaction(tx, organizationId);
          if (!metrics) {
            return null;
          }

          const drafts = runRules(metrics);
          const ids: string[] = [];
          for (const draft of drafts) {
            const finding = await tx.finding.create({
              data: {
                organizationId,
                analysisRunId: runId,
                type: draft.type,
                severity: draft.severity,
                title: draft.title,
                subjectKey: draft.subjectKey,
                evidence: draft.evidence as unknown as Prisma.InputJsonValue,
                ruleVersion: draft.ruleVersion,
              },
              select: { id: true },
            });
            ids.push(finding.id);
          }

          await tx.analysisRun.update({
            where: { id: runId },
            data: {
              status: 'COMPLETED',
              referenceDate: metrics.referenceDate,
              currentStart: metrics.current.start,
              currentEnd: metrics.current.end,
              previousStart: metrics.previous.start,
              previousEnd: metrics.previous.end,
              metricsSnapshot: serializeMetricsSnapshot(
                metrics,
              ) as unknown as Prisma.InputJsonValue,
              errorMessage: null,
              completedAt: new Date(),
            },
          });

          return ids;
        },
        // Metrics aggregates over months of rows and the finding writes must be
        // one atomic transaction (no partial findings), so this legitimately
        // takes longer than Prisma's 5s default on a busy machine.
        { timeoutMs: 30_000 },
      );

      if (outcome === null) {
        await this.markFailed(organizationId, runId, 'No orders available to analyze.');
        return;
      }
      findingIds = outcome;
    } catch (error) {
      this.logger.warn(`Analysis run ${runId} failed (${safeErrorCode(error)}).`);
      await this.markFailed(organizationId, runId, 'Analysis failed.').catch(() => undefined);
      throw new Error('Analysis failed.', { cause: error });
    }

    await this.enqueueExplanations(organizationId, findingIds);
  }

  private async markFailed(organizationId: string, runId: string, message: string): Promise<void> {
    await this.tenantPrisma.run(organizationId, (tx) =>
      tx.analysisRun.updateMany({
        where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      }),
    );
  }

  /**
   * One AI job per finding, after the findings are committed. A Redis failure
   * must not turn a completed analysis into a failed one: the finding and its
   * evidence remain fully usable and the explanation can be regenerated.
   */
  private async enqueueExplanations(
    organizationId: string,
    findingIds: readonly string[],
  ): Promise<void> {
    if (findingIds.length === 0) {
      return;
    }

    try {
      await Promise.all(
        findingIds.map((findingId) =>
          this.queueService.enqueue(
            QUEUE_NAMES.aiExplanation,
            JOB_NAMES.generateExplanation,
            { organizationId, findingId },
            { jobId: findingId },
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(`Could not enqueue AI explanations (${safeErrorCode(error)}).`);
    }
  }
}
