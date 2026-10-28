import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditDataModule } from '../audit/audit-data.module';
import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';

@Module({
  imports: [AuditDataModule, AiModule],
  controllers: [FindingsController],
  providers: [FindingsService],
})
export class FindingsModule {}
