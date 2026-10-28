import { Module } from '@nestjs/common';
import { QueueModule } from '../../queues/queue.module';
import { AuditModule } from '../audit/audit.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { UploadsCleanupService } from './uploads-cleanup.service';

@Module({
  imports: [AuditModule, QueueModule],
  controllers: [ImportsController],
  providers: [ImportsService, UploadsCleanupService],
})
export class ImportsModule {}
