import { Module } from '@nestjs/common';
import { QueueModule } from '../../queues/queue.module';
import { AuditModule } from '../audit/audit.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [AuditModule, QueueModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
