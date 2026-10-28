import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueService } from './queue.service';
import { TenantJobRunner } from './tenant-job-runner';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [TenantJobRunner, QueueService],
  exports: [TenantJobRunner, QueueService],
})
export class QueueModule {}
