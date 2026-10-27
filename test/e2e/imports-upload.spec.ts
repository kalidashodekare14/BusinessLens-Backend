import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Test } from 'supertest';
import request from 'supertest';
import { AuditAction } from '../../src/modules/audit/audit.actions';
import { AuditService } from '../../src/modules/audit/audit.service';
import { MAX_CSV_BYTES } from '../../src/modules/imports/csv/csv-content';
import { PrismaService } from '../../src/prisma/prisma.service';
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

const ORDERS_CSV =
  'Order ID,Order Date,Status,Product,SKU,Qty,Unit Price\n' +
  '1001,2026-01-01,completed,Widget,SKU-1,2,9.99\n' +
  '1002,2026-01-02,completed,Gadget,SKU-2,1,19.99\n';

describe('imports upload (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];
  const storagePaths: string[] = [];
  let recordSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('imports') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);

    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Imports Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);
  });

  beforeEach(() => {
    recordSpy = jest.spyOn(ctx.app.get(AuditService), 'record');
  });

  afterEach(() => {
    recordSpy.mockRestore();
  });

  afterAll(async () => {
    // Let fire-and-forget audit writes finish before tearing down the app.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await ctx.app
      .get(TenantPrismaService)
      .run(organizationId, (tx) => tx.importJob.deleteMany({ where: { organizationId } }));
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

  function endpoint(): string {
    return `/api/v1/organizations/${organizationId}/imports`;
  }

  function upload(
    contents: string | Buffer,
    fileName: string,
    type?: string,
    extraFields: Record<string, string> = {},
  ): Test {
    let req = request(ctx.server).post(endpoint()).set(auth());

    if (type !== undefined) {
      req = req.field('type', type);
    }
    for (const [name, value] of Object.entries(extraFields)) {
      req = req.field(name, value);
    }

    return req.attach(
      'file',
      Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
      fileName,
    );
  }

  async function storedJob(jobId: string) {
    return ctx.app.get(TenantPrismaService).run(organizationId, (tx) =>
      tx.importJob.findUnique({
        where: { id: jobId },
        select: {
          organizationId: true,
          createdById: true,
          type: true,
          status: true,
          originalFileName: true,
          detectedHeaders: true,
          columnMapping: true,
          storagePath: true,
        },
      }),
    );
  }

  it('stores an ORDERS upload, detects headers and suggests a mapping', async () => {
    const res = await upload(ORDERS_CSV, 'orders.csv', 'ORDERS');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'ORDERS',
      status: 'UPLOADED',
      originalFileName: 'orders.csv',
      detectedHeaders: ['Order ID', 'Order Date', 'Status', 'Product', 'SKU', 'Qty', 'Unit Price'],
      suggestedMapping: {
        orderId: 'Order ID',
        orderedAt: 'Order Date',
        status: 'Status',
        productName: 'Product',
        sku: 'SKU',
        quantity: 'Qty',
        unitPrice: 'Unit Price',
      },
    });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.data).not.toHaveProperty('storagePath');

    const job = await storedJob(res.body.data.id);
    expect(job).toMatchObject({
      organizationId,
      createdById: user.id,
      type: 'ORDERS',
      status: 'UPLOADED',
      originalFileName: 'orders.csv',
      columnMapping: null,
    });
    expect(job?.detectedHeaders).toEqual(res.body.data.detectedHeaders);
    expect(job?.storagePath).toBeTruthy();
    expect(existsSync(job!.storagePath)).toBe(true);
    storagePaths.push(job!.storagePath);

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.IMPORT_UPLOADED,
        actorId: user.id,
        organizationId,
        entityType: 'ImportJob',
        entityId: res.body.data.id,
        metadata: { type: 'ORDERS' },
      }),
    );
  });

  it('stores a PRODUCTS upload', async () => {
    const res = await upload('Name,SKU,Price\nWidget,SKU-1,9.99\n', 'products.csv', 'PRODUCTS');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'PRODUCTS',
      status: 'UPLOADED',
      originalFileName: 'products.csv',
      detectedHeaders: ['Name', 'SKU', 'Price'],
      suggestedMapping: { name: 'Name', sku: 'SKU', price: 'Price' },
    });

    const job = await storedJob(res.body.data.id);
    storagePaths.push(job!.storagePath);
  });

  it('rejects a missing file and a missing type', async () => {
    const noFile = await request(ctx.server).post(endpoint()).set(auth()).field('type', 'ORDERS');
    expect(noFile.status).toBe(400);
    expect(noFile.body.error.code).toBe('VALIDATION_FAILED');
    expect(noFile.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'file' })]),
    );

    const noType = await upload(ORDERS_CSV, 'orders.csv');
    expect(noType.status).toBe(400);
    expect(noType.body.error.code).toBe('VALIDATION_FAILED');
    expect(noType.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'type' })]),
    );
  });

  it('never accepts an organization id from the request body', async () => {
    const res = await upload(ORDERS_CSV, 'orders.csv', 'ORDERS', {
      organizationId: createdOrganizationIds[0],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'organizationId' })]),
    );
  });

  it.each([
    ['a non-csv extension', 'orders.txt', 'ORDERS', Buffer.from(ORDERS_CSV)],
    ['binary content', 'orders.csv', 'ORDERS', Buffer.from([0x00, 0x01, 0x02, 0x03])],
    ['an empty file', 'orders.csv', 'ORDERS', Buffer.alloc(0)],
    ['duplicate headers', 'products.csv', 'PRODUCTS', Buffer.from('Name,Name\nA,B\n')],
    ['a blank header', 'orders.csv', 'ORDERS', Buffer.from('Order ID,\n1,2\n')],
  ])('rejects %s', async (_case, fileName, type, contents) => {
    const res = await upload(contents, fileName, type);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CSV_FILE');
  });

  it('rejects a file above 5 MB', async () => {
    const res = await upload(Buffer.alloc(MAX_CSV_BYTES + 1, 0x61), 'orders.csv', 'ORDERS');

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 404 to an outsider and creates no ImportJob for them', async () => {
    const outsider = await registerUser(ctx.server, { email: uniqueEmail('imports-outsider') });
    createdEmails.push(outsider.email);
    const outsiderSession = await loginUser(ctx.server, outsider);

    const res = await request(ctx.server)
      .post(endpoint())
      .set({ Authorization: `Bearer ${outsiderSession.accessToken}` })
      .field('type', 'ORDERS')
      .attach('file', Buffer.from(ORDERS_CSV), 'orders.csv');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const count = await ctx.app
      .get(TenantPrismaService)
      .run(organizationId, (tx) => tx.importJob.count({ where: { createdById: outsider.id } }));
    expect(count).toBe(0);
  });

  it('allows a MEMBER to upload', async () => {
    const member = await registerUser(ctx.server, { email: uniqueEmail('imports-member') });
    createdEmails.push(member.email);
    const memberSession = await loginUser(ctx.server, member);

    await ctx.app.get(PrismaService).membership.create({
      data: { userId: member.id, organizationId, role: 'MEMBER' },
    });

    const res = await request(ctx.server)
      .post(endpoint())
      .set({ Authorization: `Bearer ${memberSession.accessToken}` })
      .field('type', 'ORDERS')
      .attach('file', Buffer.from(ORDERS_CSV), 'orders.csv');

    expect(res.status).toBe(201);
    const job = await storedJob(res.body.data.id);
    expect(job?.createdById).toBe(member.id);
    storagePaths.push(job!.storagePath);
  });
});
