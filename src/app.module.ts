import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      // Validation runs synchronously inside forRoot, so the app refuses to boot on bad config.
      validate: (env) => {
        parseConfig(env as NodeJS.ProcessEnv);
        return env as Record<string, string>;
      },
    }),
  ],
})
export class AppModule {}
