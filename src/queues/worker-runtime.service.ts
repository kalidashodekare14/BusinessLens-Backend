import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { QueueProcessor } from './queue-processor';
import { buildRedisConnectionOptions } from './redis-connection';

/** DI token for the processors this worker process should consume. */
export const QUEUE_PROCESSORS = 'QUEUE_PROCESSORS';

/**
 * Starts one BullMQ Worker per registered processor and closes them on shutdown.
 * The API process never creates workers; only src/worker.module.ts registers
 * processors, so long work always runs outside HTTP requests (§4).
 *
 * Concurrency is 1 for the MVP: imports must not race each other on the same
 * organization's rows, and the small dataset does not need parallelism.
 */
@Injectable()
export class WorkerRuntimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private workers: Worker[] = [];

  constructor(
    private readonly config: ConfigService,
    @Inject(QUEUE_PROCESSORS) private readonly processors: QueueProcessor[],
  ) {}

  onApplicationBootstrap(): void {
    this.start();
  }

  start(): void {
    if (this.workers.length > 0) {
      return;
    }

    if (this.processors.length === 0) {
      this.logger.warn('No queue processors registered; this worker will not consume jobs.');
      return;
    }

    const connection = buildRedisConnectionOptions(this.config.getOrThrow<string>('REDIS_URL'));

    for (const processor of this.processors) {
      const worker = new Worker(processor.queue, (job) => this.dispatch(processor, job), {
        connection,
        concurrency: 1,
      });

      worker.on('failed', (job, error) => {
        // Job ids and queue names are safe to log; payloads and CSV rows are not.
        this.logger.error(
          `Job failed: ${processor.queue}/${processor.jobName} (job ${job?.id ?? 'unknown'}) - ${error.message}`,
        );
      });
      worker.on('error', (error) => {
        this.logger.error(`Queue connection error on ${processor.queue}: ${error.message}`);
      });

      this.workers.push(worker);
      this.logger.log(`Consuming ${processor.queue} jobs (${processor.jobName})`);
    }
  }

  async stop(): Promise<void> {
    const workers = this.workers;
    this.workers = [];
    await Promise.all(workers.map((worker) => worker.close()));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  private dispatch(processor: QueueProcessor, job: Job): Promise<unknown> {
    if (job.name !== processor.jobName) {
      throw new Error(`Unexpected job "${job.name}" on queue "${processor.queue}"`);
    }
    return processor.process(job);
  }
}
