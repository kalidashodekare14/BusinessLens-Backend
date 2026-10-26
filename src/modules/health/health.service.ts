import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { withTimeout } from '../../common/utils/with-timeout';
import { REDIS_CLIENT } from './health.tokens';

export type CheckStatus = 'ok' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: {
    database: CheckStatus;
    redis: CheckStatus;
  };
  timestamp: string;
}

export interface HealthResult {
  report: HealthReport;
  healthy: boolean;
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private static readonly CHECK_TIMEOUT_MS = 2000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthResult> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const healthy = database === 'ok' && redis === 'ok';
    return {
      report: {
        status: healthy ? 'ok' : 'degraded',
        checks: { database, redis },
        timestamp: new Date().toISOString(),
      },
      healthy,
    };
  }

  private async checkDatabase(): Promise<CheckStatus> {
    try {
      // SELECT 1 never touches tenant tables, so it works without T2.1 grants.
      await withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        HealthService.CHECK_TIMEOUT_MS,
        'database check timed out',
      );
      return 'ok';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckStatus> {
    try {
      await withTimeout(this.redis.ping(), HealthService.CHECK_TIMEOUT_MS, 'redis check timed out');
      return 'ok';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // Already closed or never connected; nothing to do at shutdown.
    }
  }
}
