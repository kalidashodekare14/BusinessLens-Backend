import type { ConfigModuleOptions } from '@nestjs/config';
import { parseConfig } from './configuration';

/**
 * Shared by src/app.module.ts and src/worker.module.ts so both processes read the
 * same .env and refuse to boot with the same aggregated CONFIG_INVALID message.
 */
export function createConfigModuleOptions(): ConfigModuleOptions {
  return {
    isGlobal: true,
    envFilePath: ['.env'],
    // Validation runs synchronously inside forRoot, so an invalid environment
    // rejects NestFactory.create/createApplicationContext before anything connects.
    validate: (env) => {
      parseConfig(env as NodeJS.ProcessEnv);
      return env as Record<string, string>;
    },
  };
}
