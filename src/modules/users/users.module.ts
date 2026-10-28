import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PasswordService } from './password.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuditModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
