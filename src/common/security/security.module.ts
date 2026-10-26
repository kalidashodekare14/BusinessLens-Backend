import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../modules/auth/token.constants';

/**
 * Global JWT wiring so guards and feature modules can inject JwtService without
 * importing the auth module (which would create cycles with UsersModule).
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
  ],
  exports: [JwtModule],
})
export class SecurityModule {}
