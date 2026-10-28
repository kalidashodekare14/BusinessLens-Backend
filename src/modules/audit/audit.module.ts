import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditDataModule } from './audit-data.module';

@Module({
  imports: [AuditDataModule],
  controllers: [AuditController],
  exports: [AuditDataModule],
})
export class AuditModule {}
