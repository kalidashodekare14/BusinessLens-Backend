import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue, type Job } from 'bullmq';
import { createConfigModuleOptions } from '../../src/config/config-module-options';
import type { Prisma } from '../../src/generated/prisma/client';
import { JOB_NAMES, QUEUE_NAMES } from '../../src/queues/queue.constants';
import { QueueModule } from '../../src/queues/queue.module';
import { QueueService } from '../../src/queues/queue.service';
import { TenantJobProcessor } from '../../src/queues/queue-processor';
import { buildRedisConnectionOptions } from '../../src/queues/redis-connection';
import { TenantJobRunner } from '../../src/queues/tenant-job-runner';
import { QUEUE_PROCESSORS, WorkerRuntimeService } from '../../src/queues/worker-runtime.service';

/**
 * Real Redis round trip: the producer enqueues, the worker runtime consumes, and
 * the processor sees the organization context set by TenantJobRunner. Requires
 * the docker-compose Redis (same as the other integration suites).
 */
@Injectable()
class ContextProbeProcessor extends TenantJobProcessor<void> {
  readonly queue = QUEUE_NAMES.importProcessing;
  readonly jobName = JOB_NAMES.processImport;
  readonly organizationIds: string[] = [];

  constructor(jobs: TenantJobRunner) {
    super(jobs);
  }

  protected async execute(_job: Job, tx: Prisma.TransactionClient): Promise<void> {
    const rows = await tx.$queryRaw<{ organization_id: string | null }[]>`
      SELECT current_setting('app.organization_id', true) AS organization_id`;
    const organizationId = rows[0]?.organization_id;
    if (organizationId) {
      this.organizationIds.push(organizationId);
    }
  }
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  description: string,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${description}`);
}

describe('queue runtime (real Redis)', () => {
  let moduleRef: TestingModule;
  let queueService: QueueService;
  let inspectionQueue: Queue;
  let processor: ContextProbeProcessor;
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(createConfigModuleOptions()), QueueModule],
      providers: [
        ContextProbeProcessor,
        WorkerRuntimeService,
        {
          provide: QUEUE_PROCESSORS,
          inject: [ContextProbeProcessor],
          useFactory: (probe: ContextProbeProcessor) => [probe],
        },
      ],
    }).compile();

    await moduleRef.init();

    processor = moduleRef.get(ContextProbeProcessor);
    queueService = moduleRef.get(QueueService);

    const redisUrl = moduleRef.get(ConfigService).getOrThrow<string>('REDIS_URL');
    inspectionQueue = new Queue(QUEUE_NAMES.importProcessing, {
      connection: buildRedisConnectionOptions(redisUrl),
    });
  });

  afterAll(async () => {
    for (const jobId of createdJobIds) {
      const job = await inspectionQueue?.getJob(jobId);
      if (job) {
        await job.remove();
      }
    }
    await inspectionQueue?.close();
    await moduleRef?.close();
  });

  it('consumes a job and sets the organization context from the payload', async () => {
    const organizationId = randomUUID();
    const jobId = randomUUID();
    createdJobIds.push(jobId);

    await queueService.enqueue(
      QUEUE_NAMES.importProcessing,
      JOB_NAMES.processImport,
      { organizationId },
      { jobId, removeOnComplete: true },
    );

    await waitFor(
      () => processor.organizationIds.includes(organizationId),
      'the worker to consume the job with the payload organization',
    );
  });

  it('fails a job whose payload has no valid organizationId, without executing it', async () => {
    const jobId = randomUUID();
    createdJobIds.push(jobId);

    await queueService.enqueue(
      QUEUE_NAMES.importProcessing,
      JOB_NAMES.processImport,
      { organizationId: 'not-a-uuid' },
      { jobId, removeOnComplete: true },
    );

    let failedReason: string | undefined;
    await waitFor(async () => {
      const job = await inspectionQueue.getJob(jobId);
      if (!job) {
        return false;
      }
      failedReason = job.failedReason;
      // BullMQ can expose the failed state a moment before the reason is readable.
      return (await job.getState()) === 'failed' && Boolean(failedReason);
    }, 'the invalid job to fail with a reason');

    expect(failedReason).toContain('organizationId');
  });
});
