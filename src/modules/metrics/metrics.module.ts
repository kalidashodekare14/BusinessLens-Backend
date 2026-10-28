import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsDataModule } from './metrics-data.module';

@Module({
  imports: [MetricsDataModule],
  controllers: [MetricsController],
  exports: [MetricsDataModule],
})
export class MetricsModule {}
