import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createConfigModuleOptions } from './config/config-module-options';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityModule } from './common/security/security.module';
import { QueueModule } from './queues/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ImportsModule } from './modules/imports/imports.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot(createConfigModuleOptions()),
    PrismaModule,
    SecurityModule,
    QueueModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ImportsModule,
    HealthModule,
  ],
})
export class AppModule {}
