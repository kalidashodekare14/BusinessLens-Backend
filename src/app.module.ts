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
import { CatalogModule } from './modules/catalog/catalog.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { FindingsModule } from './modules/findings/findings.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
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
    CatalogModule,
    MetricsModule,
    AnalysisModule,
    FindingsModule,
    DashboardModule,
    HealthModule,
  ],
})
export class AppModule {}
