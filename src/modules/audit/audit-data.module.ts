import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Service-only half of the audit feature. The worker imports this instead of
 * AuditModule: importing a module that owns a controller would instantiate
 * AuditController and its JwtAuthGuard in a process with no HTTP pipeline and
 * no JwtService, which crashes the worker on boot.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditDataModule {}
