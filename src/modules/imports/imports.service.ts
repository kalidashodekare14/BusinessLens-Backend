import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ImportStatus, ImportType } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';
import { assertCsvContent } from './csv/csv-content';
import { CsvValidationError } from './csv/csv-error';
import { normalizeDetectedHeaders, readCsvHeader } from './csv/header';
import { suggestMapping, type SuggestedMapping } from './csv/suggest-mapping';

export interface ImportUploadView {
  id: string;
  type: ImportType;
  status: ImportStatus;
  originalFileName: string;
  detectedHeaders: string[];
  suggestedMapping: SuggestedMapping;
  createdAt: Date;
}

/**
 * Only the base name is kept: multer's originalname is client-controlled and must
 * never influence the storage path.
 */
function sanitizeOriginalFileName(value: string): string {
  const base = value.replace(/^.*[\\/]/, '');
  const cleaned = Array.from(base)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return (cleaned.length > 0 ? cleaned : 'upload.csv').slice(0, 255);
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly config: ConfigService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    organizationId: string,
    userId: string,
    type: ImportType,
    file: Express.Multer.File | undefined,
  ): Promise<ImportUploadView> {
    if (!file) {
      throw apiError(400, 'VALIDATION_FAILED', 'Validation failed', [
        { field: 'file', message: 'file is required' },
      ]);
    }

    const originalFileName = sanitizeOriginalFileName(file.originalname);
    if (path.extname(originalFileName).toLowerCase() !== '.csv') {
      throw apiError(422, 'INVALID_CSV_FILE', 'Only .csv files are supported.');
    }

    try {
      assertCsvContent(file.buffer);
      const detectedHeaders = normalizeDetectedHeaders(await readCsvHeader(file.buffer));
      const suggestedMapping = suggestMapping(type, detectedHeaders);
      const storagePath = await this.writeTempFile(file.buffer);

      let job: {
        id: string;
        type: ImportType;
        status: ImportStatus;
        createdAt: Date;
      };
      try {
        job = await this.tenantPrisma.run(organizationId, (tx) =>
          tx.importJob.create({
            data: {
              organizationId,
              createdById: userId,
              type,
              originalFileName,
              storagePath,
              detectedHeaders,
            },
            select: { id: true, type: true, status: true, createdAt: true },
          }),
        );
      } catch (error) {
        await unlink(storagePath).catch(() => undefined);
        throw error;
      }

      this.audit.record({
        action: AuditAction.IMPORT_UPLOADED,
        actorId: userId,
        organizationId,
        entityType: 'ImportJob',
        entityId: job.id,
        metadata: { type },
      });

      return { ...job, originalFileName, detectedHeaders, suggestedMapping };
    } catch (error) {
      if (error instanceof CsvValidationError) {
        throw apiError(422, 'INVALID_CSV_FILE', error.message);
      }
      throw error;
    }
  }

  private async writeTempFile(buffer: Buffer): Promise<string> {
    const uploadDir = path.resolve(this.config.getOrThrow<string>('UPLOAD_DIR'));
    await mkdir(uploadDir, { recursive: true });

    const storagePath = path.join(uploadDir, `${randomUUID()}.csv`);
    // wx refuses to overwrite; mode 0600 keeps uploads private to the process user.
    await writeFile(storagePath, buffer, { flag: 'wx', mode: 0o600 });
    return storagePath;
  }
}
