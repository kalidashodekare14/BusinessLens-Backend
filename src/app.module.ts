import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseConfig } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityModule } from './common/security/security.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
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
    SecurityModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    HealthModule,
  ],
})
export class AppModule {}
