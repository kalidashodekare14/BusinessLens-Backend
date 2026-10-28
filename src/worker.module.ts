import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createConfigModuleOptions } from './config/config-module-options';
import { AnalysisProcessor } from './modules/analysis/analysis.processor';
import { ImportProcessor } from './modules/imports/imports.processor';
import { MetricsModule } from './modules/metrics/metrics.module';
import { QueueModule } from './queues/queue.module';
import { WorkerRuntimeService, QUEUE_PROCESSORS } from './queues/worker-runtime.service';

/**
 * Worker process container: same environment validation as the API, no HTTP
 * pipeline. Processors register here as they are implemented.
 */
@Module({
  imports: [ConfigModule.forRoot(createConfigModuleOptions()), QueueModule, MetricsModule],
  providers: [
    WorkerRuntimeService,
    ImportProcessor,
    AnalysisProcessor,
    {
      provide: QUEUE_PROCESSORS,
      inject: [ImportProcessor, AnalysisProcessor],
      useFactory: (imports: ImportProcessor, analysis: AnalysisProcessor) => [imports, analysis],
    },
  ],
})
export class WorkerModule {}
