import { createReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { isUUID } from 'class-validator';
import { CsvError, parse } from 'csv-parse';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../queues/queue.constants';
import type { QueueProcessor } from '../../queues/queue-processor';
import { TenantJobRunner } from '../../queues/tenant-job-runner';
import { readStoredHeaders } from './csv/header';
import { validateMapping, type CanonicalMapping } from './csv/mapping';
import { createRowMapper } from './csv/row-mapper';
import { validateProductRow, type ValidatedProductRow } from './csv/row-validator';
import { resolveUploadPath } from './csv/storage-path';

export const IMPORT_BATCH_SIZE = 500;
export const IMPORT_ERROR_REPORT_LIMIT = 1000;

interface ImportErrorEntry {
  rowNumber: number;
  field: string;
  reason: string;
}

interface ProcessingOutcome {
  /** Attempted data rows (valid + invalid); failedRows is the skipped subset. */
  totalRows: number;
  failedRows: number;
  errorReport: ImportErrorEntry[];
  fatal: boolean;
}

function readImportJobId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const importJobId = (payload as Record<string, unknown>).importJobId;
  return typeof importJobId === 'string' && isUUID(importJobId, '4') ? importJobId : null;
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function headersMatch(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function isFileReadError(error: unknown): boolean {
  if (error instanceof CsvError) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * PRODUCTS import worker (TASKS.md T3.5).
 *
 * This processor intentionally does not extend `TenantJobProcessor`: every batch
 * commits its products and progress in its own tenant transaction, so the polling
 * endpoints can see progress. The base class would hold one transaction open for
 * the whole file and hide every checkpoint until the end. Payload validation still
 * goes through `TenantJobRunner`, and every query runs inside
 * `TenantPrismaService.run`.
 */
@Injectable()
export class ImportProcessor implements QueueProcessor {
  readonly queue = QUEUE_NAMES.importProcessing;
  readonly jobName = JOB_NAMES.processImport;

  constructor(
    private readonly tenantJobs: TenantJobRunner,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: ConfigService,
  ) {}

  async process(job: Job): Promise<void> {
    const organizationId = this.tenantJobs.resolveOrganizationId(job.data);
    const importJobId = readImportJobId(job.data);
    if (!importJobId) {
      throw new Error('Job payload is missing a valid importJobId.');
    }

    const stored = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.importJob.findUnique({
        where: { id: importJobId },
        select: {
          id: true,
          type: true,
          status: true,
          storagePath: true,
          detectedHeaders: true,
          columnMapping: true,
        },
      }),
    );

    if (!stored) {
      throw new Error('Import job not found.');
    }
    // A duplicate delivery after completion, or a job whose confirm was rolled
    // back, must not start a second import.
    if (stored.status !== 'PROCESSING') {
      return;
    }

    if (stored.type !== 'PRODUCTS') {
      // T3.6 adds ORDERS. Confirm already rejects them; this is a defense in depth.
      await this.markFailed(organizationId, importJobId);
      return;
    }

    const detectedHeaders = readStoredHeaders(stored.detectedHeaders);
    const storedMapping = readJsonObject(stored.columnMapping);
    const mapping =
      detectedHeaders && storedMapping
        ? validateMapping('PRODUCTS', detectedHeaders, storedMapping)
        : null;
    const storagePath = resolveUploadPath(
      this.config.getOrThrow<string>('UPLOAD_DIR'),
      stored.storagePath,
    );

    if (!detectedHeaders || !mapping?.valid || !storagePath) {
      await this.markFailed(organizationId, importJobId);
      return;
    }

    let outcome: ProcessingOutcome;
    try {
      outcome = await this.processProducts(
        organizationId,
        importJobId,
        storagePath,
        detectedHeaders,
        mapping.mapping,
      );
      await this.finish(organizationId, importJobId, outcome);
    } catch {
      await this.markFailed(organizationId, importJobId).catch(() => undefined);
      // Never surface a database or parser message: it may contain CSV values.
      throw new Error('Import processing failed.');
    }
  }

  private async processProducts(
    organizationId: string,
    importJobId: string,
    storagePath: string,
    detectedHeaders: string[],
    mapping: CanonicalMapping,
  ): Promise<ProcessingOutcome> {
    const source = createReadStream(storagePath);
    const parser = source.pipe(
      parse({
        bom: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );
    source.on('error', (error) => parser.destroy(error));

    const mapRow = createRowMapper('PRODUCTS', detectedHeaders, mapping);
    const outcome: ProcessingOutcome = {
      totalRows: 0,
      failedRows: 0,
      errorReport: [],
      fatal: false,
    };
    const pending: ValidatedProductRow[] = [];
    let headerSeen = false;
    let rowsSinceFlush = 0;

    const flush = async (): Promise<void> => {
      await this.tenantPrisma.run(organizationId, async (tx) => {
        for (const product of pending) {
          await tx.product.upsert({
            where: {
              organizationId_name: { organizationId, name: product.name },
            },
            create: {
              organizationId,
              name: product.name,
              sku: product.sku,
              price: product.price,
            },
            update: { sku: product.sku, price: product.price },
          });
        }

        await tx.importJob.update({
          where: { id: importJobId },
          data: {
            processedRows: outcome.totalRows,
            failedRows: outcome.failedRows,
            errorReport: this.errorReportJson(outcome.errorReport),
          },
        });
      });

      pending.length = 0;
      rowsSinceFlush = 0;
    };

    const iterator = parser[Symbol.asyncIterator]();
    try {
      while (true) {
        let next: IteratorResult<unknown>;
        try {
          next = await iterator.next();
        } catch (error) {
          if (isFileReadError(error)) {
            outcome.fatal = true;
            break;
          }
          throw error;
        }

        if (next.done) {
          break;
        }

        const cells = (next.value as unknown[]).map((value) => String(value ?? ''));

        if (!headerSeen) {
          if (!headersMatch(cells, detectedHeaders)) {
            outcome.fatal = true;
            break;
          }
          headerSeen = true;
          continue;
        }

        outcome.totalRows += 1;
        rowsSinceFlush += 1;

        const result = validateProductRow(mapRow(cells));
        if (result.valid) {
          pending.push(result.value);
        } else {
          outcome.failedRows += 1;
          for (const issue of result.errors) {
            if (outcome.errorReport.length >= IMPORT_ERROR_REPORT_LIMIT) {
              break;
            }
            outcome.errorReport.push({
              rowNumber: outcome.totalRows,
              field: issue.field,
              reason: issue.reason,
            });
          }
        }

        if (rowsSinceFlush >= IMPORT_BATCH_SIZE) {
          await flush();
        }
      }
    } finally {
      source.destroy();
      parser.destroy();
    }

    // Commit the trailing partial batch (and its progress) even when the file
    // turned out to be unreadable, so counters match what was actually handled.
    if (pending.length > 0 || rowsSinceFlush > 0) {
      await flush();
    }

    return outcome;
  }

  private async finish(
    organizationId: string,
    importJobId: string,
    outcome: ProcessingOutcome,
  ): Promise<void> {
    const failed =
      outcome.fatal || outcome.totalRows === 0 || outcome.failedRows === outcome.totalRows;

    await this.tenantPrisma.run(organizationId, (tx) =>
      tx.importJob.update({
        where: { id: importJobId },
        data: {
          status: failed ? 'FAILED' : 'COMPLETED',
          totalRows: outcome.totalRows,
          processedRows: outcome.totalRows,
          failedRows: outcome.failedRows,
          errorReport: this.errorReportJson(outcome.errorReport),
          completedAt: new Date(),
        },
      }),
    );
  }

  private async markFailed(organizationId: string, importJobId: string): Promise<void> {
    await this.tenantPrisma.run(organizationId, (tx) =>
      tx.importJob.update({
        where: { id: importJobId },
        data: { status: 'FAILED', completedAt: new Date() },
      }),
    );
  }

  private errorReportJson(report: ImportErrorEntry[]) {
    return report.length > 0 ? (report as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  }
}
