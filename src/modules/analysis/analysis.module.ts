import { Module } from '@nestjs/common';
import { QueueModule } from '../../queues/queue.module';
import { AuditDataModule } from '../audit/audit-data.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [AuditDataModule, QueueModule, MetricsModule],
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}
