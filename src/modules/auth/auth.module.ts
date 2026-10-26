import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService],
})
export class AuthModule {}
