import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditDataModule } from '../audit/audit-data.module';
import { UsersModule } from '../users/users.module';
import {
  AUTH_THROTTLE_LIMIT,
  AUTH_THROTTLE_MESSAGE,
  AUTH_THROTTLE_TTL_MS,
} from './auth-throttle.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [
    UsersModule,
    AuditDataModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT }],
      errorMessage: AUTH_THROTTLE_MESSAGE,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService],
})
export class AuthModule {}
