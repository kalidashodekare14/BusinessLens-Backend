import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContextService } from './tenant-context.service';
import { TenantPrismaService } from './tenant-prisma.service';

@Global()
@Module({
  providers: [PrismaService, TenantPrismaService, TenantContextService],
  exports: [PrismaService, TenantPrismaService, TenantContextService],
})
export class PrismaModule {}
