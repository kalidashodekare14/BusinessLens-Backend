import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { REDIS_CLIENT } from './health.tokens';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
        // Health checks are the only consumer; failures surface as rejected pings,
        // so swallow the event to avoid an unhandled 'error' crash.
        client.on('error', () => undefined);
        return client;
      },
    },
  ],
})
export class HealthModule {}
