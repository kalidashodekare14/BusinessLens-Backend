import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import type { Prisma } from '../../../src/generated/prisma/client';
import { JOB_NAMES, QUEUE_NAMES } from '../../../src/queues/queue.constants';
import { TenantJobProcessor } from '../../../src/queues/queue-processor';
import { TenantJobPayloadError, TenantJobRunner } from '../../../src/queues/tenant-job-runner';
import type { TenantPrismaService } from '../../../src/prisma/tenant-prisma.service';

class ProbeProcessor extends TenantJobProcessor<string> {
  readonly queue = QUEUE_NAMES.importProcessing;
  readonly jobName = JOB_NAMES.processImport;
  readonly calls: { jobId: string; tx: Prisma.TransactionClient }[] = [];

  protected execute(job: Job, tx: Prisma.TransactionClient): Promise<string> {
    this.calls.push({ jobId: String(job.id), tx });
    return Promise.resolve(`done:${String(job.id)}`);
  }
}

function jobWith(data: unknown): Job {
  return { id: 'job-1', name: JOB_NAMES.processImport, data } as Job;
}

describe('TenantJobProcessor', () => {
  let run: jest.Mock;
  let runner: TenantJobRunner;
  let processor: ProbeProcessor;

  beforeEach(() => {
    run = jest.fn();
    runner = new TenantJobRunner({ run } as unknown as TenantPrismaService);
    processor = new ProbeProcessor(runner);
  });

  it('runs the handler inside the tenant context from the payload', async () => {
    const organizationId = randomUUID();
    const tx = { marker: 'transaction-client' } as unknown as Prisma.TransactionClient;
    run.mockImplementation(
      async (_organizationId: string, callback: (client: unknown) => unknown) => callback(tx),
    );

    await expect(processor.process(jobWith({ organizationId }))).resolves.toBe('done:job-1');

    expect(run).toHaveBeenCalledWith(organizationId, expect.any(Function));
    expect(processor.calls).toEqual([{ jobId: 'job-1', tx }]);
  });

  it('rejects a payload without a valid organizationId before any database work', async () => {
    await expect(processor.process(jobWith({}))).rejects.toBeInstanceOf(TenantJobPayloadError);

    expect(run).not.toHaveBeenCalled();
    expect(processor.calls).toHaveLength(0);
  });

  it('propagates handler failures so BullMQ can mark the job failed', async () => {
    const organizationId = randomUUID();
    run.mockImplementation(
      async (_organizationId: string, callback: (client: unknown) => unknown) => callback({}),
    );

    const failing = new (class extends ProbeProcessor {
      protected override async execute(): Promise<string> {
        throw new Error('processor failed');
      }
    })(runner);

    await expect(failing.process(jobWith({ organizationId }))).rejects.toThrow('processor failed');
    expect(failing.calls).toHaveLength(0);
  });
});
