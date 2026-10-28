import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import type { ImportStatus, ImportType } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';
import { ImportsService } from '../imports/imports.service';

export interface DemoImportView {
  id: string;
  type: ImportType;
  status: ImportStatus;
}

export interface DemoLoadView {
  status: 'PROCESSING';
  imports: DemoImportView[];
}

/** The sample dataset that ships with the repository (§16). */
const SAMPLE_FILES = [
  { type: 'PRODUCTS' as const, fileName: 'products.csv' },
  { type: 'ORDERS' as const, fileName: 'orders.csv' },
];

/** Upload → mapping → confirm uses the client's file object shape (§8). */
function toMulterFile(fileName: string, buffer: Buffer): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: fileName,
    encoding: 'utf-8',
    mimetype: 'text/csv',
    size: buffer.byteLength,
    buffer,
    stream: Readable.from(buffer),
    // Disk fields are required by the multer type but unused: the import path
    // only reads `buffer` and `originalname` (this file never touches disk).
    destination: '',
    filename: fileName,
    path: '',
  };
}

/**
 * Loads the sample dataset through the exact import pipeline a client uses
 * (§8): content sniffing, header detection, mapping validation and the queued
 * worker. No direct writes to tenant tables, so the demo proves the real code
 * path instead of a shortcut (T6.2).
 */
@Injectable()
export class DemoDataService {
  constructor(
    private readonly imports: ImportsService,
    private readonly audit: AuditService,
  ) {}

  async load(organizationId: string, userId: string): Promise<DemoLoadView> {
    const imports: DemoImportView[] = [];
    for (const sample of SAMPLE_FILES) {
      imports.push(await this.importOne(organizationId, userId, sample.type, sample.fileName));
    }

    this.audit.record({
      action: AuditAction.DEMO_DATA_LOADED,
      actorId: userId,
      organizationId,
      metadata: { importIds: imports.map((entry) => entry.id) },
    });

    return { status: 'PROCESSING', imports };
  }

  private async importOne(
    organizationId: string,
    userId: string,
    type: ImportType,
    fileName: string,
  ): Promise<DemoImportView> {
    const buffer = await this.readSampleFile(fileName);
    const upload = await this.imports.upload(
      organizationId,
      userId,
      type,
      toMulterFile(fileName, buffer),
    );
    // The suggested mapping is a suggestion like any other: it goes through the
    // same validation and preview as a client-provided one.
    await this.imports.updateMapping(organizationId, upload.id, upload.suggestedMapping);
    const confirmed = await this.imports.confirm(organizationId, userId, upload.id);
    return { id: confirmed.id, type: confirmed.type, status: confirmed.status };
  }

  private async readSampleFile(fileName: string): Promise<Buffer> {
    try {
      return await readFile(path.resolve(process.cwd(), 'sample-data', fileName));
    } catch {
      // No filesystem details to the client (§6.5); the log keeps the name only.
      throw apiError(500, 'DEMO_DATA_UNAVAILABLE', 'The sample dataset is unavailable.');
    }
  }
}
