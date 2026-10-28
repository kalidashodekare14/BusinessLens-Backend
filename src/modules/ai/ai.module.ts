import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueModule } from '../../queues/queue.module';
import { AuditDataModule } from '../audit/audit-data.module';
import { AI_CLIENT } from './ai-client';
import { AiProcessor } from './ai.processor';
import { ExplanationsService } from './explanations.service';
import { GeminiClient } from './gemini.client';

/**
 * AI explanation feature (§10). The real Gemini client is bound to the
 * `AI_CLIENT` token here; tests construct the processor with a fake client
 * instead of overriding this binding, so no test can reach the real API (§13).
 * The API process only ever needs `ExplanationsService` — AI calls run in the
 * worker, never inline in a request.
 */
@Module({
  imports: [QueueModule, AuditDataModule],
  providers: [
    {
      provide: AI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new GeminiClient({
          apiKey: config.getOrThrow<string>('GEMINI_API_KEY'),
          model: config.getOrThrow<string>('GEMINI_MODEL'),
        }),
    },
    ExplanationsService,
    AiProcessor,
  ],
  exports: [ExplanationsService, AiProcessor],
})
export class AiModule {}
