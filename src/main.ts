import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/app-setup';
import { ConfigValidationError } from './config/configuration';

async function bootstrap(): Promise<void> {
  try {
    // abortOnError: false makes config validation errors reject here instead of
    // exiting inside Nest's ExceptionHandler, so we can print a clean message.
    const app = await NestFactory.create(AppModule, { abortOnError: false });
    configureApp(app);
    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

void bootstrap();
