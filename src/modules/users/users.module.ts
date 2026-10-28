import { Module } from '@nestjs/common';
import { AuditDataModule } from '../audit/audit-data.module';
import { PasswordService } from './password.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuditDataModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
