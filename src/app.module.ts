import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseConfig } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';

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
    PrismaModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
