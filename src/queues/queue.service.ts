import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES, type JobName, type QueueName } from './queue.constants';
import { buildRedisConnectionOptions } from './redis-connection';

/** Bounded retention: Redis is only a queue, never the source of truth (§4). */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
};

/**
 * Producer side of the three queues. The API only enqueues ids; the worker loads
 * the rest under a tenant transaction. Payloads are validated again by the
 * processor base, so a malformed payload fails without touching tenant tables.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues: Record<QueueName, Queue>;
  private closed = false;

  constructor(config: ConfigService) {
    const connection = buildRedisConnectionOptions(config.getOrThrow<string>('REDIS_URL'));
    this.queues = {
      [QUEUE_NAMES.importProcessing]: new Queue(QUEUE_NAMES.importProcessing, {
        connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
      [QUEUE_NAMES.analysis]: new Queue(QUEUE_NAMES.analysis, {
        connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
      [QUEUE_NAMES.aiExplanation]: new Queue(QUEUE_NAMES.aiExplanation, {
        connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    };
  }

  async enqueue(
    queueName: QueueName,
    jobName: JobName,
    payload: unknown,
    options: JobsOptions = {},
  ): Promise<string> {
    const job: Job = await this.queues[queueName].add(jobName, payload, options);
    if (!job.id) {
      throw new Error('BullMQ did not assign a job id');
    }
    return job.id;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }
}
