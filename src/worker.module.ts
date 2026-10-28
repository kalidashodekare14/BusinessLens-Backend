import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createConfigModuleOptions } from './config/config-module-options';
import { QueueModule } from './queues/queue.module';
import { WorkerRuntimeService, QUEUE_PROCESSORS } from './queues/worker-runtime.service';

/**
 * Worker process container: same environment validation as the API, no HTTP
 * pipeline. Processors register here as they are implemented; T3.5 adds the
 * import processor to QUEUE_PROCESSORS.
 */
@Module({
  imports: [ConfigModule.forRoot(createConfigModuleOptions()), QueueModule],
  providers: [
    WorkerRuntimeService,
    {
      provide: QUEUE_PROCESSORS,
      useValue: [],
    },
  ],
})
export class WorkerModule {}
