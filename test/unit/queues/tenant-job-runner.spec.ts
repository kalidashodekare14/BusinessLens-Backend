import { randomUUID } from 'node:crypto';
import { TenantJobPayloadError, TenantJobRunner } from '../../../src/queues/tenant-job-runner';
import type { TenantPrismaService } from '../../../src/prisma/tenant-prisma.service';

describe('TenantJobRunner', () => {
  let run: jest.Mock;
  let runner: TenantJobRunner;

  beforeEach(() => {
    run = jest.fn();
    runner = new TenantJobRunner({ run } as unknown as TenantPrismaService);
  });

  const invalidPayloads: unknown[] = [
    undefined,
    null,
    {},
    { organizationId: '' },
    { organizationId: '   ' },
    { organizationId: 'org-a' },
    { organizationId: 42 },
    'org-a',
  ];

  it.each(invalidPayloads)('rejects %p before opening a tenant transaction', async (payload) => {
    const handler = jest.fn();

    await expect(runner.run(payload, handler)).rejects.toBeInstanceOf(TenantJobPayloadError);

    expect(handler).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('wraps the handler in the payload organization context', async () => {
    const organizationId = randomUUID();
    const tx = { marker: 'transaction-client' };
    const handler = jest.fn().mockResolvedValue('done');
    run.mockImplementation(
      async (_organizationId: string, callback: (client: unknown) => unknown) => callback(tx),
    );

    await expect(runner.run({ organizationId }, handler)).resolves.toBe('done');

    expect(run).toHaveBeenCalledWith(organizationId, expect.any(Function));
    expect(handler).toHaveBeenCalledWith(tx);
  });

  it('propagates handler failures so the queue can retry or fail the job', async () => {
    const organizationId = randomUUID();
    run.mockImplementation(
      async (_organizationId: string, callback: (client: unknown) => unknown) => callback({}),
    );

    await expect(
      runner.run({ organizationId }, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
  });
});
