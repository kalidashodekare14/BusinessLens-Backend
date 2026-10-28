import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Service-only half of the metrics feature (§5). The worker imports this
 * instead of MetricsModule: importing a module that owns a controller would
 * instantiate the controller and its JWT guard in a process with no HTTP
 * pipeline and no JwtService, which crashes the worker on boot.
 */
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsDataModule {}
