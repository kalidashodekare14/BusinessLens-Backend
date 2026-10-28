import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

/**
 * The only way feature code may touch tenant tables.
 *
 * Every tenant table has FORCE ROW LEVEL SECURITY. `run` opens an interactive
 * transaction, sets `app.organization_id` for that transaction only, and hands the
 * callback a client scoped to it. Tenant code must never use `PrismaService`
 * directly; a missing or wrong context makes RLS return zero rows or reject writes.
 */
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    organizationId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!organizationId) {
      throw new Error('organizationId is required for tenant queries');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      return fn(tx);
    });
  }
}
