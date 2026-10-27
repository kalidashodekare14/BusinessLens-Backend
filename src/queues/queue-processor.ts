import type { Job } from 'bullmq';
import type { Prisma } from '../generated/prisma/client';
import type { JobName, QueueName } from './queue.constants';
import { TenantJobRunner } from './tenant-job-runner';

export interface QueueProcessor<TResult = unknown> {
  readonly queue: QueueName;
  readonly jobName: JobName;
  process(job: Job): Promise<TResult>;
}

/**
 * BullMQ-facing base for tenant jobs (TASKS.md T3.1, hooking into T2.4).
 *
 * Every processor declares the queue and job name it handles and implements
 * `execute`, which only ever receives the transaction scoped to the payload's
 * organization. `TenantJobRunner` validates `organizationId` before any database
 * work, so a malformed payload fails the job without touching tenant tables.
 * Processors must never read `organizationId` from the rows they load.
 *
 * Concrete processors must be @Injectable() and declare their own constructor
 * (`constructor(jobs: TenantJobRunner) { super(jobs); }`) so Nest emits the
 * dependency metadata; an inherited constructor alone is not injected.
 */
export abstract class TenantJobProcessor<TResult = unknown> implements QueueProcessor<TResult> {
  abstract readonly queue: QueueName;
  abstract readonly jobName: JobName;

  constructor(protected readonly tenantJobs: TenantJobRunner) {}

  process(job: Job): Promise<TResult> {
    return this.tenantJobs.run(job.data, (tx) => this.execute(job, tx));
  }

  protected abstract execute(job: Job, tx: Prisma.TransactionClient): Promise<TResult>;
}
