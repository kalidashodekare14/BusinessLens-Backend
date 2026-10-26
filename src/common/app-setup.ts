import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor';
import { accessLogMiddleware, requestIdMiddleware } from './request-id';

/**
 * Single wiring point for everything HTTP-related, shared by src/main.ts and the
 * e2e tests so tests exercise the exact production pipeline.
 * Must be called after NestFactory.create and before init()/listen().
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const corsOrigins = config
    .getOrThrow<string>('CORS_ORIGIN')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(accessLogMiddleware);
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Grouped errors give the exception filter { field: messages[] }, which it
      // maps to the stable details: [{ field, message }] contract.
      errorFormat: 'grouped',
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
}
