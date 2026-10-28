import type { Redis } from 'ioredis';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { HealthService } from '../../../src/modules/health/health.service';

type RedisFake = { ping: jest.Mock; quit: jest.Mock };

function makeService(overrides: { prisma?: jest.Mock; redis?: RedisFake } = {}): {
  service: HealthService;
  prismaMock: jest.Mock;
  redisMock: RedisFake;
} {
  const prismaMock = overrides.prisma ?? jest.fn().mockResolvedValue([{ ok: 1 }]);
  const redisMock = overrides.redis ?? {
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  const service = new HealthService(
    { $queryRaw: prismaMock } as unknown as PrismaService,
    redisMock as unknown as Redis,
  );
  return { service, prismaMock, redisMock };
}

describe('HealthService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports ok when both checks pass', async () => {
    const { service } = makeService();

    const { report, healthy } = await service.check();

    expect(healthy).toBe(true);
    expect(report.status).toBe('ok');
    expect(report.checks).toEqual({ database: 'ok', redis: 'ok' });
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
  });

  it('reports degraded when the database is down', async () => {
    const { service } = makeService({
      prisma: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    const { report, healthy } = await service.check();

    expect(healthy).toBe(false);
    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ database: 'down', redis: 'ok' });
  });

  it('reports degraded when Redis is down', async () => {
    const { service } = makeService({
      redis: { ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), quit: jest.fn() },
    });

    const { report, healthy } = await service.check();

    expect(healthy).toBe(false);
    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ database: 'ok', redis: 'down' });
  });

  it('times out a hanging database check', async () => {
    jest.useFakeTimers();
    const { service } = makeService({
      prisma: jest.fn().mockReturnValue(new Promise(() => undefined)),
    });

    const pending = service.check();
    await jest.advanceTimersByTimeAsync(2100);
    const { report, healthy } = await pending;

    expect(healthy).toBe(false);
    expect(report.checks.database).toBe('down');
    expect(report.checks.redis).toBe('ok');
  });

  it('closes the Redis connection on shutdown', async () => {
    const { service, redisMock } = makeService();

    await service.onModuleDestroy();

    expect(redisMock.quit).toHaveBeenCalledTimes(1);
  });

  it('swallows quit failures on shutdown', async () => {
    const { service } = makeService({
      redis: { ping: jest.fn(), quit: jest.fn().mockRejectedValue(new Error('already closed')) },
    });

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
