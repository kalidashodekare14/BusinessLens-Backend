import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createConfigModuleOptions } from './config/config-module-options';
import { AiModule } from './modules/ai/ai.module';
import { AiProcessor } from './modules/ai/ai.processor';
import { AnalysisProcessor } from './modules/analysis/analysis.processor';
import { ImportProcessor } from './modules/imports/imports.processor';
import { MetricsDataModule } from './modules/metrics/metrics-data.module';
import { QueueModule } from './queues/queue.module';
import { WorkerRuntimeService, QUEUE_PROCESSORS } from './queues/worker-runtime.service';

/**
 * Worker process container: same environment validation as the API, no HTTP
 * pipeline. Processors register here as they are implemented.
 */
@Module({
  imports: [
    ConfigModule.forRoot(createConfigModuleOptions()),
    QueueModule,
    MetricsDataModule,
    AiModule,
  ],
  providers: [
    WorkerRuntimeService,
    ImportProcessor,
    AnalysisProcessor,
    // AiProcessor comes from AiModule (which owns the AI_CLIENT binding);
    // re-providing it here would create a second instance that cannot resolve
    // AI_CLIENT and crashes the worker on boot.
    {
      provide: QUEUE_PROCESSORS,
      inject: [ImportProcessor, AnalysisProcessor, AiProcessor],
      useFactory: (imports: ImportProcessor, analysis: AnalysisProcessor, ai: AiProcessor) => [
        imports,
        analysis,
        ai,
      ],
    },
  ],
})
export class WorkerModule {}
