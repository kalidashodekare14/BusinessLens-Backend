import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import type { AuditAction } from './audit.actions';

export interface AuditEvent {
  action: AuditAction;
  actorId?: string | null;
  organizationId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes audit rows without delaying or failing the operation being audited (§6.5).
 * Failures are logged with the action only: metadata must never reach the logs.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /** Fire-and-forget by design; callers must not await it. */
  record(event: AuditEvent): void {
    void this.write(event);
  }

  private async write(event: AuditEvent): Promise<void> {
    try {
      if (event.organizationId) {
        // AuditLog is a tenant table. Organization lifecycle events happen outside
        // a tenant request, so this sets the context itself.
        await this.tenantPrisma.run(event.organizationId, async (tx) => {
          await tx.auditLog.createMany({ data: [this.toRow(event)] });
        });
      } else {
        // The RLS insert policy accepts null-organization auth events, which are
        // written before an organization context exists and never read by tenants.
        await this.prisma.auditLog.createMany({ data: [this.toRow(event)] });
      }
    } catch {
      this.logger.warn(`Failed to write audit event ${event.action}`);
    }
  }

  private toRow(event: AuditEvent) {
    return {
      action: event.action,
      actorId: event.actorId ?? null,
      organizationId: event.organizationId ?? null,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    };
  }
}
