import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';

@Module({
  imports: [AuditModule, AiModule],
  controllers: [FindingsController],
  providers: [FindingsService],
})
export class FindingsModule {}
