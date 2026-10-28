import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createConfigModuleOptions } from './config/config-module-options';
import { ImportProcessor } from './modules/imports/imports.processor';
import { QueueModule } from './queues/queue.module';
import { WorkerRuntimeService, QUEUE_PROCESSORS } from './queues/worker-runtime.service';

/**
 * Worker process container: same environment validation as the API, no HTTP
 * pipeline. Processors register here as they are implemented.
 */
@Module({
  imports: [ConfigModule.forRoot(createConfigModuleOptions()), QueueModule],
  providers: [
    WorkerRuntimeService,
    ImportProcessor,
    {
      provide: QUEUE_PROCESSORS,
      inject: [ImportProcessor],
      useFactory: (imports: ImportProcessor) => [imports],
    },
  ],
})
export class WorkerModule {}
