import { Module } from '@nestjs/common';
import { AuditDataModule } from '../audit/audit-data.module';
import { ImportsModule } from '../imports/imports.module';
import { DemoController } from './demo.controller';
import { DemoDataService } from './demo.service';

@Module({
  imports: [AuditDataModule, ImportsModule],
  controllers: [DemoController],
  providers: [DemoDataService],
})
export class DemoModule {}
