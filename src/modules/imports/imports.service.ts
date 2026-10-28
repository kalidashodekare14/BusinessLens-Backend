import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type ImportStatus, type ImportType } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../queues/queue.constants';
import { QueueService } from '../../queues/queue.service';
import { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';
import { assertCsvContent } from './csv/csv-content';
import { CsvValidationError } from './csv/csv-error';
import { normalizeDetectedHeaders, readCsvHeader, readStoredHeaders } from './csv/header';
import { validateMapping, type CanonicalMapping } from './csv/mapping';
import { readCsvPreview, type CsvPreview } from './csv/preview';
import { resolveUploadPath } from './csv/storage-path';
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

export interface ImportMappingView {
  id: string;
  type: ImportType;
  status: ImportStatus;
  detectedHeaders: string[];
  mapping: CanonicalMapping;
  preview: CsvPreview;
}

export interface ImportConfirmView {
  id: string;
  type: ImportType;
  status: ImportStatus;
}

export interface ImportListItemView {
  id: string;
  type: ImportType;
  status: ImportStatus;
  originalFileName: string;
  totalRows: number;
  processedRows: number;
  failedRows: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ImportPage {
  data: ImportListItemView[];
  meta: { page: number; pageSize: number; total: number };
}

export interface ImportDetailView extends ImportListItemView {
  detectedHeaders: string[] | null;
  columnMapping: Record<string, string | null> | null;
}

export interface ImportErrorView {
  rowNumber: number;
  field: string;
  reason: string;
}

export interface ImportErrorsPage {
  data: ImportErrorView[];
  meta: { page: number; pageSize: number; total: number };
}

const IMPORT_LIST_SELECT = {
  id: true,
  type: true,
  status: true,
  originalFileName: true,
  totalRows: true,
  processedRows: true,
  failedRows: true,
  createdAt: true,
  completedAt: true,
} as const;

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
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

/** Stored JSON columns are untrusted after a migration or manual edit; keep only usable entries. */
function readStoredMapping(value: unknown): Record<string, string | null> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const mapping: Record<string, string | null> = {};
  for (const [key, mapped] of Object.entries(value as Record<string, unknown>)) {
    if (typeof mapped === 'string' || mapped === null) {
      mapping[key] = mapped;
    }
  }
  return mapping;
}

function readErrorReport(value: unknown): ImportErrorView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: ImportErrorView[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.rowNumber !== 'number' ||
      !Number.isInteger(entry.rowNumber) ||
      typeof entry.field !== 'string' ||
      typeof entry.reason !== 'string'
    ) {
      continue;
    }
    entries.push({ rowNumber: entry.rowNumber, field: entry.field, reason: entry.reason });
  }
  return entries;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly config: ConfigService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
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

  async updateMapping(
    organizationId: string,
    importId: string,
    input: Record<string, unknown>,
  ): Promise<ImportMappingView> {
    const job = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.importJob.findUnique({
        where: { id: importId },
        select: {
          id: true,
          type: true,
          status: true,
          detectedHeaders: true,
          storagePath: true,
        },
      }),
    );

    if (!job) {
      throw apiError(404, 'NOT_FOUND', 'Import not found.');
    }
    if (job.status !== 'UPLOADED' && job.status !== 'MAPPED') {
      throw apiError(409, 'IMPORT_NOT_MAPPABLE', 'This import can no longer be mapped.');
    }

    const detectedHeaders = readStoredHeaders(job.detectedHeaders);
    if (!detectedHeaders) {
      throw apiError(500, 'INTERNAL_ERROR', 'Import metadata is unavailable.');
    }

    const validation = validateMapping(job.type, detectedHeaders, input);
    if (!validation.valid) {
      throw apiError(400, 'VALIDATION_FAILED', 'Validation failed', validation.issues);
    }

    const storagePath = resolveUploadPath(
      this.config.getOrThrow<string>('UPLOAD_DIR'),
      job.storagePath,
    );
    if (!storagePath) {
      throw apiError(409, 'IMPORT_FILE_UNAVAILABLE', 'The uploaded file is no longer available.');
    }

    const preview = await this.previewFile(
      storagePath,
      detectedHeaders,
      job.type,
      validation.mapping,
    );

    try {
      await this.tenantPrisma.run(organizationId, (tx) =>
        tx.importJob.update({
          where: { id: job.id, status: { in: ['UPLOADED', 'MAPPED'] } },
          data: { status: 'MAPPED', columnMapping: validation.mapping },
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw apiError(409, 'IMPORT_NOT_MAPPABLE', 'This import can no longer be mapped.');
      }
      throw error;
    }

    return {
      id: job.id,
      type: job.type,
      status: 'MAPPED',
      detectedHeaders,
      mapping: validation.mapping,
      preview,
    };
  }

  async confirm(
    organizationId: string,
    userId: string,
    importId: string,
  ): Promise<ImportConfirmView> {
    const job = await this.tenantPrisma.run(organizationId, async (tx) => {
      const found = await tx.importJob.findUnique({
        where: { id: importId },
        select: { id: true, type: true, status: true, columnMapping: true },
      });

      if (!found) {
        throw apiError(404, 'NOT_FOUND', 'Import not found.');
      }
      if (found.status !== 'MAPPED' || found.columnMapping === null) {
        throw apiError(
          409,
          'IMPORT_NOT_CONFIRMABLE',
          'This import cannot be confirmed in its current state.',
        );
      }
      try {
        return await tx.importJob.update({
          where: { id: found.id, status: 'MAPPED' },
          data: {
            status: 'PROCESSING',
            totalRows: 0,
            processedRows: 0,
            failedRows: 0,
            errorReport: Prisma.DbNull,
            completedAt: null,
          },
          select: { id: true, type: true, status: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw apiError(
            409,
            'IMPORT_NOT_CONFIRMABLE',
            'This import cannot be confirmed in its current state.',
          );
        }
        throw error;
      }
    });

    try {
      await this.queue.enqueue(
        QUEUE_NAMES.importProcessing,
        JOB_NAMES.processImport,
        { organizationId, importJobId: job.id },
        // One job per import; a duplicate confirm cannot start a second run.
        { jobId: job.id },
      );
    } catch {
      // Redis is not the source of truth: put the import back so the user can retry.
      await this.tenantPrisma
        .run(organizationId, (tx) =>
          tx.importJob.updateMany({
            where: { id: job.id, status: 'PROCESSING' },
            data: { status: 'MAPPED' },
          }),
        )
        .catch(() => undefined);
      throw apiError(503, 'IMPORT_QUEUE_UNAVAILABLE', 'The import could not be queued.');
    }

    this.audit.record({
      action: AuditAction.IMPORT_CONFIRMED,
      actorId: userId,
      organizationId,
      entityType: 'ImportJob',
      entityId: job.id,
      metadata: { type: job.type },
    });

    return job;
  }

  async list(organizationId: string, page: number, pageSize: number): Promise<ImportPage> {
    const { jobs, total } = await this.tenantPrisma.run(organizationId, async (tx) => {
      const [jobs, total] = await Promise.all([
        tx.importJob.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: IMPORT_LIST_SELECT,
        }),
        tx.importJob.count({ where: { organizationId } }),
      ]);
      return { jobs, total };
    });

    return { data: jobs, meta: { page, pageSize, total } };
  }

  async get(organizationId: string, importId: string): Promise<ImportDetailView> {
    const job = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.importJob.findUnique({
        where: { id: importId },
        select: {
          ...IMPORT_LIST_SELECT,
          detectedHeaders: true,
          columnMapping: true,
        },
      }),
    );

    if (!job) {
      throw apiError(404, 'NOT_FOUND', 'Import not found.');
    }

    return {
      ...job,
      detectedHeaders: readStoredHeaders(job.detectedHeaders),
      columnMapping: readStoredMapping(job.columnMapping),
    };
  }

  async errors(
    organizationId: string,
    importId: string,
    page: number,
    pageSize: number,
  ): Promise<ImportErrorsPage> {
    const job = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.importJob.findUnique({
        where: { id: importId },
        select: { errorReport: true },
      }),
    );

    if (!job) {
      throw apiError(404, 'NOT_FOUND', 'Import not found.');
    }

    const entries = readErrorReport(job.errorReport);
    const start = (page - 1) * pageSize;
    return {
      data: entries.slice(start, start + pageSize),
      meta: { page, pageSize, total: entries.length },
    };
  }

  private async previewFile(
    storagePath: string,
    detectedHeaders: string[],
    type: ImportType,
    mapping: CanonicalMapping,
  ): Promise<CsvPreview> {
    try {
      return await readCsvPreview(storagePath, detectedHeaders, type, mapping);
    } catch (error) {
      if (error instanceof CsvValidationError) {
        throw apiError(409, 'IMPORT_FILE_INVALID', error.message);
      }
      if (hasErrnoCode(error, 'ENOENT')) {
        throw apiError(409, 'IMPORT_FILE_UNAVAILABLE', 'The uploaded file is no longer available.');
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
