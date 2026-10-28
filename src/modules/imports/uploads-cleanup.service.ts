import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { removeOrphanedUploads } from './csv/upload-cleanup';

/** One sweep per hour: orphaned uploads are only relevant after 24 hours. */
export const UPLOAD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Removes uploads that were never processed. Runs in the API process because the
 * API writes the files; the timer is unref'd and cleared on shutdown so it can
 * never keep the process (or a test run) alive.
 */
@Injectable()
export class UploadsCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadsCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, UPLOAD_CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<void> {
    try {
      const removed = await removeOrphanedUploads(this.config.getOrThrow<string>('UPLOAD_DIR'));
      if (removed > 0) {
        this.logger.log(`Removed ${removed} orphaned upload file(s).`);
      }
    } catch {
      // Cleanup must never crash the API; the next sweep retries.
      this.logger.warn('Orphaned upload cleanup failed.');
    }
  }
}
