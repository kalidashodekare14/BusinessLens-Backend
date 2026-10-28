import { unlink } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import request from 'supertest';
import { AuditAction } from '../../src/modules/audit/audit.actions';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ImportProcessor } from '../../src/modules/imports/imports.processor';
import { JOB_NAMES, QUEUE_NAMES } from '../../src/queues/queue.constants';
import { QueueService } from '../../src/queues/queue.service';
import { TenantJobRunner } from '../../src/queues/tenant-job-runner';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { deleteOrganizationsById, deleteUsersByEmail } from '../helpers/db';
import {
  loginUser,
  registerUser,
  uniqueEmail,
  type LoginSession,
  type RegisteredUser,
} from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const PRODUCT_MAPPING = { name: 'Name', sku: 'SKU', price: 'Price' };
const ORDER_MAPPING = {
  orderId: 'Order ID',
  orderedAt: 'Order Date',
  status: 'Status',
  productName: 'Product',
  sku: 'SKU',
  quantity: 'Qty',
  unitPrice: 'Unit Price',
};

const MIXED_PRODUCTS_CSV =
  'Name,SKU,Price\n' +
  'Widget,SKU-1,9.99\n' +
  'Broken,SKU-B,not-a-price\n' +
  'Gadget,SKU-2,19.99\n';

const ORDERS_CSV =
  'Order ID,Order Date,Status,Product,SKU,Qty,Unit Price\n' +
  '1001,2026-01-01,completed,Widget,SKU-1,1,9.99\n';

function productsCsv(count: number, price = '9.99'): string {
  const rows = Array.from(
    { length: count },
    (_, index) => `Product ${index + 1},SKU-${index + 1},${price}`,
  );
  return ['Name,SKU,Price', ...rows].join('\n') + '\n';
}

describe('import confirmation and processing (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  let queueSpy: jest.SpyInstance;
  let recordSpy: jest.SpyInstance;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];
  const storagePaths: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('import-confirm') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Confirm Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);

    queueSpy = jest.spyOn(ctx.app.get(QueueService), 'enqueue').mockResolvedValue('queued-job-id');
    recordSpy = jest.spyOn(ctx.app.get(AuditService), 'record');
  });

  afterEach(() => {
    queueSpy.mockRestore();
    recordSpy.mockRestore();
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));

    const tenant = ctx.app.get(TenantPrismaService);
    for (const id of createdOrganizationIds) {
      await tenant.run(id, (tx) => tx.product.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.importJob.deleteMany({ where: { organizationId: id } }));
    }
    await Promise.all(
      storagePaths.map((storagePath) => unlink(storagePath).catch(() => undefined)),
    );
    await deleteOrganizationsById(ctx.app, createdOrganizationIds);
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  function auth(token = session.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  function endpoint(orgId = organizationId): string {
    return `/api/v1/organizations/${orgId}/imports`;
  }

  async function upload(
    contents: string,
    type: 'ORDERS' | 'PRODUCTS' = 'PRODUCTS',
    orgId = organizationId,
  ): Promise<{ id: string; headers: string[] }> {
    const res = await request(ctx.server)
      .post(endpoint(orgId))
      .set(auth())
      .field('type', type)
      .attach('file', Buffer.from(contents), 'data.csv');

    if (res.status !== 201) {
      throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
    }

    const storagePath = await ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const stored = await tx.importJob.findUniqueOrThrow({
        where: { id: res.body.data.id },
        select: { storagePath: true },
      });
      return stored.storagePath;
    });
    storagePaths.push(storagePath);

    return { id: res.body.data.id, headers: res.body.data.detectedHeaders };
  }

  async function map(
    importId: string,
    mapping: Record<string, string | null>,
    orgId = organizationId,
  ): Promise<void> {
    const res = await request(ctx.server)
      .put(`${endpoint(orgId)}/${importId}/mapping`)
      .set(auth())
      .send({ mapping });
    expect(res.status).toBe(200);
  }

  async function mappedProducts(csv = MIXED_PRODUCTS_CSV, orgId = organizationId) {
    const uploaded = await upload(csv, 'PRODUCTS', orgId);
    await map(uploaded.id, PRODUCT_MAPPING, orgId);
    return uploaded.id;
  }

  function confirm(importId: string, options: { orgId?: string; token?: string } = {}) {
    return request(ctx.server)
      .post(`${endpoint(options.orgId)}/${importId}/confirm`)
      .set(auth(options.token));
  }

  async function storedJob(importId: string, orgId = organizationId) {
    return ctx.app.get(TenantPrismaService).run(orgId, (tx) =>
      tx.importJob.findUnique({
        where: { id: importId },
        select: {
          status: true,
          totalRows: true,
          processedRows: true,
          failedRows: true,
          errorReport: true,
          completedAt: true,
        },
      }),
    );
  }

  async function storedProducts(orgId = organizationId) {
    return ctx.app
      .get(TenantPrismaService)
      .run(orgId, (tx) =>
        tx.product.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } }),
      );
  }

  async function runProcessor(importId: string, orgId = organizationId): Promise<void> {
    const processor = new ImportProcessor(
      ctx.app.get(TenantJobRunner),
      ctx.app.get(TenantPrismaService),
      ctx.app.get(ConfigService),
    );

    await processor.process({
      id: importId,
      name: JOB_NAMES.processImport,
      data: { organizationId: orgId, importJobId: importId },
    } as Job);
  }

  async function storagePathOf(importId: string, orgId = organizationId): Promise<string> {
    return ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const stored = await tx.importJob.findUniqueOrThrow({
        where: { id: importId },
        select: { storagePath: true },
      });
      return stored.storagePath;
    });
  }

  describe('POST /imports/:importId/confirm', () => {
    it('queues a mapped PRODUCTS import and returns 202', async () => {
      const importId = await mappedProducts();

      const res = await confirm(importId);

      expect(res.status).toBe(202);
      expect(res.body.data).toEqual({
        id: importId,
        type: 'PRODUCTS',
        status: 'PROCESSING',
      });

      expect(queueSpy).toHaveBeenCalledWith(
        QUEUE_NAMES.importProcessing,
        JOB_NAMES.processImport,
        { organizationId, importJobId: importId },
        { jobId: importId },
      );
      expect(await storedJob(importId)).toEqual({
        status: 'PROCESSING',
        totalRows: 0,
        processedRows: 0,
        failedRows: 0,
        errorReport: null,
        completedAt: null,
      });
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.IMPORT_CONFIRMED,
          actorId: user.id,
          organizationId,
          entityType: 'ImportJob',
          entityId: importId,
          metadata: { type: 'PRODUCTS' },
        }),
      );
    });

    it('rejects an unmapped, already-processing or unsupported import', async () => {
      const uploaded = await upload(MIXED_PRODUCTS_CSV);

      const unmapped = await confirm(uploaded.id);
      expect(unmapped.status).toBe(409);
      expect(unmapped.body.error.code).toBe('IMPORT_NOT_CONFIRMABLE');

      await map(uploaded.id, PRODUCT_MAPPING);
      expect((await confirm(uploaded.id)).status).toBe(202);

      const processing = await confirm(uploaded.id);
      expect(processing.status).toBe(409);
      expect(processing.body.error.code).toBe('IMPORT_NOT_CONFIRMABLE');

      const orders = await upload(ORDERS_CSV, 'ORDERS');
      await map(orders.id, ORDER_MAPPING);
      const unsupported = await confirm(orders.id);
      expect(unsupported.status).toBe(422);
      expect(unsupported.body.error.code).toBe('UNSUPPORTED_IMPORT_TYPE');
      expect(queueSpy).toHaveBeenCalledTimes(1);
    });

    it('returns the import to MAPPED when Redis cannot accept the job', async () => {
      const importId = await mappedProducts();
      queueSpy.mockRejectedValueOnce(new Error('redis unavailable'));

      const res = await confirm(importId);

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('IMPORT_QUEUE_UNAVAILABLE');
      expect((await storedJob(importId))?.status).toBe('MAPPED');
    });

    it('scopes confirmation to the organization and validates ids', async () => {
      const importId = await mappedProducts();

      const outsider = await registerUser(ctx.server, {
        email: uniqueEmail('confirm-outsider'),
      });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);

      const outside = await confirm(importId, { token: outsiderSession.accessToken });
      expect(outside.status).toBe(404);
      expect(outside.body.error.code).toBe('NOT_FOUND');

      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Confirm Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherImport = await mappedProducts(MIXED_PRODUCTS_CSV, otherOrg.body.data.id);

      const crossOrg = await confirm(otherImport);
      expect(crossOrg.status).toBe(404);
      expect(crossOrg.body.error.code).toBe('NOT_FOUND');

      const invalid = await confirm('not-a-uuid');
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_FAILED');

      const missing = await confirm('00000000-0000-4000-8000-000000000000');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');

      expect((await storedJob(importId))?.status).toBe('MAPPED');
      expect((await storedJob(otherImport, otherOrg.body.data.id))?.status).toBe('MAPPED');
      expect(queueSpy).not.toHaveBeenCalled();
    });
  });

  describe('process-import worker', () => {
    it('imports valid products, skips invalid rows and completes', async () => {
      const importId = await mappedProducts();
      await confirm(importId);

      await runProcessor(importId);

      expect(await storedJob(importId)).toMatchObject({
        status: 'COMPLETED',
        totalRows: 3,
        processedRows: 3,
        failedRows: 1,
        errorReport: [
          {
            rowNumber: 2,
            field: 'price',
            reason: 'must be a non-negative amount with at most 2 decimal places',
          },
        ],
      });
      expect((await storedJob(importId))?.completedAt).not.toBeNull();

      const products = await storedProducts();
      expect(products.map((product) => product.name)).toEqual(['Gadget', 'Widget']);
      expect(products.find((product) => product.name === 'Widget')?.price?.toFixed(2)).toBe('9.99');
      expect(products.find((product) => product.name === 'Widget')?.sku).toBe('SKU-1');
    });

    it('upserts products by name on a later import', async () => {
      const first = await mappedProducts('Name,SKU,Price\nWidget,SKU-1,9.99\n');
      await confirm(first);
      await runProcessor(first);

      const second = await mappedProducts('Name,SKU,Price\nWidget,SKU-9,12.50\n');
      await confirm(second);
      await runProcessor(second);

      const products = await storedProducts();
      expect(products).toHaveLength(1);
      expect(products[0]).toMatchObject({ name: 'Widget', sku: 'SKU-9' });
      expect(products[0].price?.toFixed(2)).toBe('12.50');
    });

    it('processes more than one batch of 500 rows', async () => {
      const importId = await mappedProducts(productsCsv(501));
      await confirm(importId);

      await runProcessor(importId);

      expect(await storedJob(importId)).toMatchObject({
        status: 'COMPLETED',
        totalRows: 501,
        processedRows: 501,
        failedRows: 0,
        errorReport: null,
      });
      expect(await storedProducts()).toHaveLength(501);
    });

    it('fails an import where every row is invalid and caps the report', async () => {
      const importId = await mappedProducts(productsCsv(1001, 'not-a-price'));
      await confirm(importId);

      await runProcessor(importId);

      const stored = await storedJob(importId);
      expect(stored).toMatchObject({
        status: 'FAILED',
        totalRows: 1001,
        processedRows: 1001,
        failedRows: 1001,
      });
      expect(stored?.errorReport).toHaveLength(1000);
      expect(await storedProducts()).toHaveLength(0);
    });

    it('fails without throwing when the stored file is gone', async () => {
      const importId = await mappedProducts();
      await confirm(importId);
      await unlink(await storagePathOf(importId));

      await expect(runProcessor(importId)).resolves.toBeUndefined();

      expect((await storedJob(importId))?.status).toBe('FAILED');
      expect((await storedJob(importId))?.completedAt).not.toBeNull();
    });

    it('does not process an import that was not confirmed', async () => {
      const importId = await mappedProducts();

      await runProcessor(importId);

      expect((await storedJob(importId))?.status).toBe('MAPPED');
      expect(await storedProducts()).toHaveLength(0);
    });

    it('cannot process another organization’s import', async () => {
      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Worker Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherOrgId = otherOrg.body.data.id as string;

      const otherImport = await mappedProducts(MIXED_PRODUCTS_CSV, otherOrgId);
      await confirm(otherImport, { orgId: otherOrgId });

      await expect(runProcessor(otherImport)).rejects.toThrow('Import job not found.');

      expect((await storedJob(otherImport, otherOrgId))?.status).toBe('PROCESSING');
      expect(await storedProducts(otherOrgId)).toHaveLength(0);
    });
  });
});
