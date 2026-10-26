import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/app-setup';

export interface TestApp {
  app: INestApplication;
  server: ReturnType<INestApplication['getHttpServer']>;
  close: () => Promise<void>;
}

/**
 * Builds the real HTTP pipeline (same configureApp as src/main.ts) against the
 * real Postgres/Redis from docker-compose. Integration tests get both the app
 * container (for services/Prisma) and the raw server for Supertest.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    server: app.getHttpServer(),
    close: () => app.close(),
  };
}
