import { access, unlink } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import request from 'supertest';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ImportProcessor } from '../../src/modules/imports/imports.processor';
import { JOB_NAMES } from '../../src/queues/queue.constants';
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

const MIXED_PRODUCTS_CSV =
  'Name,SKU,Price\n' +
  'Widget,SKU-1,9.99\n' +
  'Broken,SKU-B,not-a-price\n' +
  'Gadget,SKU-2,19.99\n';

function productCsv(name: string): string {
  return `Name,SKU,Price\n${name},SKU-${name},1.00\n`;
}

describe('import read endpoints (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  let queueSpy: jest.SpyInstance;
  let auditSpy: jest.SpyInstance;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];
  const storagePaths: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('import-read') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Read Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);

    queueSpy = jest.spyOn(ctx.app.get(QueueService), 'enqueue').mockResolvedValue('queued-job-id');
    auditSpy = jest.spyOn(ctx.app.get(AuditService), 'record');
  });

  afterEach(() => {
    queueSpy.mockRestore();
    auditSpy.mockRestore();
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));

    const tenant = ctx.app.get(TenantPrismaService);
    for (const id of createdOrganizationIds) {
      await tenant.run(id, (tx) => tx.orderItem.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.order.deleteMany({ where: { organizationId: id } }));
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

  async function createOrganization(name: string): Promise<string> {
    const res = await request(ctx.server).post('/api/v1/organizations').set(auth()).send({ name });
    expect(res.status).toBe(201);
    createdOrganizationIds.push(res.body.data.id);
    return res.body.data.id;
  }

  async function upload(
    contents: string,
    orgId = organizationId,
    type: 'PRODUCTS' | 'ORDERS' = 'PRODUCTS',
  ): Promise<{ id: string; storagePath: string }> {
    const res = await request(ctx.server)
      .post(endpoint(orgId))
      .set(auth())
      .field('type', type)
      .attach('file', Buffer.from(contents), 'data.csv');
    expect(res.status).toBe(201);

    const storagePath = await ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const stored = await tx.importJob.findUniqueOrThrow({
        where: { id: res.body.data.id },
        select: { storagePath: true },
      });
      return stored.storagePath;
    });
    storagePaths.push(storagePath);
    return { id: res.body.data.id, storagePath };
  }

  async function mappedProducts(csv = MIXED_PRODUCTS_CSV, orgId = organizationId) {
    const uploaded = await upload(csv, orgId);
    const res = await request(ctx.server)
      .put(`${endpoint(orgId)}/${uploaded.id}/mapping`)
      .set(auth())
      .send({ mapping: PRODUCT_MAPPING });
    expect(res.status).toBe(200);
    return uploaded;
  }

  async function confirm(importId: string, orgId = organizationId) {
    const res = await request(ctx.server)
      .post(`${endpoint(orgId)}/${importId}/confirm`)
      .set(auth());
    expect(res.status).toBe(202);
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

  async function fileExists(filePath: string): Promise<boolean> {
    return access(filePath).then(
      () => true,
      () => false,
    );
  }

  describe('GET /imports', () => {
    it('lists the organization imports newest first with pagination meta', async () => {
      const first = await upload(productCsv('First'));
      await new Promise((resolve) => setTimeout(resolve, 15));
      const second = await upload(productCsv('Second'));
      await new Promise((resolve) => setTimeout(resolve, 15));
      const third = await upload(productCsv('Third'));

      const pageOne = await request(ctx.server).get(`${endpoint()}?page=1&pageSize=2`).set(auth());
      expect(pageOne.status).toBe(200);
      expect(pageOne.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
      expect(pageOne.body.data.map((job: { id: string }) => job.id)).toEqual([third.id, second.id]);

      const pageTwo = await request(ctx.server).get(`${endpoint()}?page=2&pageSize=2`).set(auth());
      expect(pageTwo.status).toBe(200);
      expect(pageTwo.body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
      expect(pageTwo.body.data.map((job: { id: string }) => job.id)).toEqual([first.id]);
    });

    it('uses the default page size and rejects invalid paging', async () => {
      await upload(productCsv('Only'));

      const res = await request(ctx.server).get(endpoint()).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect(res.body.data).toHaveLength(1);

      const invalid = await request(ctx.server).get(`${endpoint()}?pageSize=101`).set(auth());
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('never lists another organization’s imports', async () => {
      await upload(productCsv('Mine'));
      const otherOrgId = await createOrganization('Other Read Co');
      const foreign = await upload(productCsv('Foreign'), otherOrgId);

      const own = await request(ctx.server).get(endpoint()).set(auth());
      expect(own.status).toBe(200);
      expect(own.body.data).toHaveLength(1);

      const other = await request(ctx.server).get(endpoint(otherOrgId)).set(auth());
      expect(other.status).toBe(200);
      expect(other.body.data.map((job: { id: string }) => job.id)).toEqual([foreign.id]);
    });

    it('returns 404 to a user with no membership in the organization', async () => {
      await upload(productCsv('Mine'));
      const outsider = await registerUser(ctx.server, { email: uniqueEmail('import-read-out') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);

      const res = await request(ctx.server).get(endpoint()).set(auth(outsiderSession.accessToken));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /imports/:importId', () => {
    it('returns headers, mapping and counters for a mapped import', async () => {
      const uploaded = await mappedProducts();

      const res = await request(ctx.server).get(`${endpoint()}/${uploaded.id}`).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: uploaded.id,
        type: 'PRODUCTS',
        status: 'MAPPED',
        originalFileName: 'data.csv',
        detectedHeaders: ['Name', 'SKU', 'Price'],
        columnMapping: PRODUCT_MAPPING,
        totalRows: 0,
        processedRows: 0,
        failedRows: 0,
        completedAt: null,
      });
    });

    it('reflects completed processing counters', async () => {
      const uploaded = await mappedProducts();
      await confirm(uploaded.id);
      await runProcessor(uploaded.id);

      const res = await request(ctx.server).get(`${endpoint()}/${uploaded.id}`).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'COMPLETED',
        totalRows: 3,
        processedRows: 3,
        failedRows: 1,
      });
      expect(res.body.data.completedAt).not.toBeNull();
    });

    it('returns 404 for another organization and 400 for an invalid id', async () => {
      const uploaded = await mappedProducts();
      const otherOrgId = await createOrganization('Other Detail Co');

      const crossOrg = await request(ctx.server)
        .get(`${endpoint(otherOrgId)}/${uploaded.id}`)
        .set(auth());
      expect(crossOrg.status).toBe(404);
      expect(crossOrg.body.error.code).toBe('NOT_FOUND');

      const invalid = await request(ctx.server).get(`${endpoint()}/not-a-uuid`).set(auth());
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_FAILED');

      const missing = await request(ctx.server)
        .get(`${endpoint()}/00000000-0000-4000-8000-000000000000`)
        .set(auth());
      expect(missing.status).toBe(404);
    });
  });

  describe('GET /imports/:importId/errors', () => {
    it('returns the stored row errors with pagination meta', async () => {
      const uploaded = await mappedProducts();
      await confirm(uploaded.id);
      await runProcessor(uploaded.id);

      const res = await request(ctx.server)
        .get(`${endpoint()}/${uploaded.id}/errors?pageSize=1`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 1, total: 1 });
      expect(res.body.data).toEqual([
        {
          rowNumber: 2,
          field: 'price',
          reason: 'must be a non-negative amount with at most 2 decimal places',
        },
      ]);
    });

    it('returns an empty list when no rows failed', async () => {
      const uploaded = await mappedProducts('Name,SKU,Price\nWidget,SKU-1,9.99\n');
      await confirm(uploaded.id);
      await runProcessor(uploaded.id);

      const res = await request(ctx.server).get(`${endpoint()}/${uploaded.id}/errors`).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 0 });
    });

    it('returns 404 for another organization’s import', async () => {
      const uploaded = await mappedProducts();
      const otherOrgId = await createOrganization('Other Errors Co');

      const res = await request(ctx.server)
        .get(`${endpoint(otherOrgId)}/${uploaded.id}/errors`)
        .set(auth());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('temp file lifecycle', () => {
    it('keeps the upload until processing starts and deletes it afterwards', async () => {
      const uploaded = await mappedProducts();
      await confirm(uploaded.id);
      await expect(fileExists(uploaded.storagePath)).resolves.toBe(true);

      await runProcessor(uploaded.id);

      await expect(fileExists(uploaded.storagePath)).resolves.toBe(false);
    });

    it('deletes the upload when every row is invalid', async () => {
      const uploaded = await mappedProducts('Name,SKU,Price\nBroken,SKU-B,not-a-price\n');
      await confirm(uploaded.id);
      await runProcessor(uploaded.id);

      const job = await ctx.app
        .get(TenantPrismaService)
        .run(organizationId, (tx) =>
          tx.importJob.findUniqueOrThrow({ where: { id: uploaded.id }, select: { status: true } }),
        );
      expect(job.status).toBe('FAILED');
      await expect(fileExists(uploaded.storagePath)).resolves.toBe(false);
    });
  });
});
