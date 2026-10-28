import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type TenantJobHandler<T> = (tx: Prisma.TransactionClient) => Promise<T>;

/** Raised before any database work when a job cannot be scoped to an organization. */
export class TenantJobPayloadError extends Error {
  constructor() {
    super('Job payload is missing a valid organizationId.');
    this.name = 'TenantJobPayloadError';
  }
}

/**
 * BullMQ-independent tenancy gate for worker jobs (TASKS.md T2.4, Option A).
 *
 * T3.1's BullMQ processor base must route every processor through `run`. The
 * organization id comes only from the validated job payload; workers have no
 * request and must never infer it from the data they read. RLS is still the last
 * line of defense if a handler ignores the transaction it is given.
 */
@Injectable()
export class TenantJobRunner {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async run<T>(payload: unknown, handler: TenantJobHandler<T>): Promise<T> {
    const organizationId = this.readOrganizationId(payload);
    return this.tenantPrisma.run(organizationId, handler);
  }

  private readOrganizationId(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
      throw new TenantJobPayloadError();
    }

    const organizationId = (payload as Record<string, unknown>).organizationId;
    // Same format the HTTP guard accepts, so malformed ids never reach the database.
    if (typeof organizationId !== 'string' || !isUUID(organizationId, '4')) {
      throw new TenantJobPayloadError();
    }

    return organizationId;
  }
}
