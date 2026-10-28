import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigValidationError } from './config/configuration';
import { WorkerModule } from './worker.module';

/**
 * Worker entry point: no HTTP server, no request pipeline. BullMQ workers keep
 * the process alive while consuming the registered processors.
 */
async function bootstrap(): Promise<void> {
  try {
    // abortOnError: false makes config validation reject here instead of
    // exiting inside Nest's ExceptionHandler, so we can print a clean message.
    const context = await NestFactory.createApplicationContext(WorkerModule, {
      abortOnError: false,
    });
    context.enableShutdownHooks();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

void bootstrap();
