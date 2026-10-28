import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget by design; callers must not await it. */
  record(event: AuditEvent): void {
    void this.write(event);
  }

  private async write(event: AuditEvent): Promise<void> {
    try {
      if (event.organizationId) {
        // Organization lifecycle events happen before a tenant request context
        // exists. Set it for this transaction so AuditLog's RLS WITH CHECK accepts
        // the row; T2.2 replaces this with TenantPrismaService.run.
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.organization_id', ${event.organizationId}, true)`;
          await tx.auditLog.createMany({ data: [this.toRow(event)] });
        });
      } else {
        // Null-organization auth events are inserted without a tenant context.
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
