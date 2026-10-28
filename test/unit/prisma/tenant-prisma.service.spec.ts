import { PrismaService } from '../../../src/prisma/prisma.service';
import { TenantPrismaService } from '../../../src/prisma/tenant-prisma.service';

describe('TenantPrismaService', () => {
  let queryRaw: jest.Mock;
  let transaction: jest.Mock;
  let service: TenantPrismaService;

  beforeEach(() => {
    queryRaw = jest.fn().mockResolvedValue([{ set_config: 'org-1' }]);
    transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ $queryRaw: queryRaw }),
    );
    service = new TenantPrismaService({
      $transaction: transaction,
    } as unknown as PrismaService);
  });

  it('sets the organization for the transaction and returns the callback result', async () => {
    const result = await service.run('org-1', async () => 'result');

    expect(result).toBe('result');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledWith(expect.any(Array), 'org-1');
  });

  it('rejects a missing organization without opening a transaction', async () => {
    await expect(service.run('', async () => 'nope')).rejects.toThrow('organizationId is required');

    expect(transaction).not.toHaveBeenCalled();
  });

  it('propagates callback failures', async () => {
    await expect(
      service.run('org-1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('forwards a bounded transaction timeout when one is requested', async () => {
    await service.run('org-1', async () => 'ok', { timeoutMs: 30_000 });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
  });

  it('leaves the Prisma defaults in place without explicit options', async () => {
    await service.run('org-1', async () => 'ok');

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), undefined);
  });

  it('runs the callback with the transaction client', async () => {
    const callback = jest.fn(async (tx: unknown) => tx);

    await expect(service.run('org-1', callback)).resolves.toEqual({
      $queryRaw: queryRaw,
    });
    expect(callback).toHaveBeenCalledWith({ $queryRaw: queryRaw });
  });
});
