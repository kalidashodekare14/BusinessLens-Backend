import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Prisma } from '../generated/prisma/client';
import { apiError } from '../common/errors/api-error';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { TenantPrismaService } from './tenant-prisma.service';

/**
 * Request-scoped bridge for services. The organization id is read only from the
 * request object populated by OrgMembershipGuard; bodies, query strings and tokens
 * are never consulted. Routes without that guard cannot obtain a tenant context.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(
    @Inject(REQUEST) private readonly request: AuthenticatedRequest,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  get organizationId(): string {
    const organization = this.request.organization;
    if (!organization) {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    return organization.id;
  }

  run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.tenantPrisma.run(this.organizationId, fn);
  }
}
