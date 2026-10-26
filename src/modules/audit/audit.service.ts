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
      // createMany (not create) so INSERT needs no SELECT privilege: AuditLog SELECT
      // grants arrive with the RLS work in T2.1.
      await this.prisma.auditLog.createMany({
        data: [
          {
            action: event.action,
            actorId: event.actorId ?? null,
            organizationId: event.organizationId ?? null,
            entityType: event.entityType ?? null,
            entityId: event.entityId ?? null,
            ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
          },
        ],
      });
    } catch {
      this.logger.warn(`Failed to write audit event ${event.action}`);
    }
  }
}
