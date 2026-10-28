import { unlink } from 'node:fs/promises';
import request from 'supertest';
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

const ORDER_HEADERS = ['Order ID', 'Order Date', 'Status', 'Product', 'SKU', 'Qty', 'Unit Price'];

const FULL_ORDER_MAPPING = {
  orderId: 'Order ID',
  orderedAt: 'Order Date',
  status: 'Status',
  productName: 'Product',
  sku: 'SKU',
  quantity: 'Qty',
  unitPrice: 'Unit Price',
};

const MINIMAL_ORDER_MAPPING = {
  orderId: 'Order ID',
  orderedAt: 'Order Date',
  productName: 'Product',
  quantity: 'Qty',
  unitPrice: 'Unit Price',
};

const SIMPLE_ORDER_HEADERS = 'Order ID,Order Date,Product,Qty,Unit Price';

function ordersCsv(rowCount: number): string {
  const rows = Array.from(
    { length: rowCount },
    (_, index) => `${1000 + index},2026-01-01,Widget,1,9.99`,
  );
  return [SIMPLE_ORDER_HEADERS, ...rows].join('\n') + '\n';
}

describe('imports mapping (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];
  const storagePaths: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('mapping') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);

    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Mapping Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));

    const tenant = ctx.app.get(TenantPrismaService);
    for (const id of createdOrganizationIds) {
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
    type: 'ORDERS' | 'PRODUCTS' = 'ORDERS',
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
      const job = await tx.importJob.findUniqueOrThrow({
        where: { id: res.body.data.id },
        select: { storagePath: true },
      });
      return job.storagePath;
    });
    storagePaths.push(storagePath);

    return { id: res.body.data.id, headers: res.body.data.detectedHeaders };
  }

  function putMapping(
    importId: string,
    mapping: Record<string, string | null>,
    options: { orgId?: string; token?: string } = {},
  ) {
    return request(ctx.server)
      .put(`${endpoint(options.orgId)}/${importId}/mapping`)
      .set(auth(options.token))
      .send({ mapping });
  }

  async function storedJob(importId: string, orgId = organizationId) {
    return ctx.app.get(TenantPrismaService).run(orgId, (tx) =>
      tx.importJob.findUnique({
        where: { id: importId },
        select: { status: true, columnMapping: true },
      }),
    );
  }

  it('saves the mapping, moves the import to MAPPED and previews validated rows', async () => {
    const { id } = await upload(ORDERS_CSV);

    const res = await putMapping(id, FULL_ORDER_MAPPING);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      type: 'ORDERS',
      status: 'MAPPED',
      detectedHeaders: ORDER_HEADERS,
      mapping: FULL_ORDER_MAPPING,
      preview: {
        truncated: false,
        rows: [
          {
            rowNumber: 1,
            values: {
              orderId: '1001',
              orderedAt: '2026-01-01',
              status: 'completed',
              productName: 'Widget',
              sku: 'SKU-1',
              quantity: '2',
              unitPrice: '9.99',
            },
            valid: true,
            errors: [],
          },
          {
            rowNumber: 2,
            values: {
              orderId: '1002',
              orderedAt: '2026-01-02',
              status: 'completed',
              productName: 'Gadget',
              sku: 'SKU-2',
              quantity: '1',
              unitPrice: '19.99',
            },
            valid: true,
            errors: [],
          },
        ],
      },
    });

    expect(await storedJob(id)).toEqual({
      status: 'MAPPED',
      columnMapping: FULL_ORDER_MAPPING,
    });
  });

  it('returns per-row errors in the preview without rejecting the mapping', async () => {
    const csv =
      'Order ID,Order Date,Product,Qty,Unit Price\n' +
      '1,2026-01-01,Widget,2,9.99\n' +
      '2,not-a-date,Gadget,1,19.99\n' +
      '3,2026-01-03,Gizmo,0,5.00\n';
    const { id } = await upload(csv);

    const res = await putMapping(id, MINIMAL_ORDER_MAPPING);

    expect(res.status).toBe(200);
    expect(res.body.data.mapping).toEqual({
      ...MINIMAL_ORDER_MAPPING,
      status: null,
      sku: null,
    });

    const rows = res.body.data.preview.rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ rowNumber: 1, valid: true, errors: [] });
    expect(rows[1]).toMatchObject({
      rowNumber: 2,
      valid: false,
      errors: [
        {
          field: 'orderedAt',
          reason: 'must be a date or datetime (YYYY-MM-DD or ISO 8601)',
        },
      ],
    });
    expect(rows[2]).toMatchObject({
      rowNumber: 3,
      valid: false,
      errors: [{ field: 'quantity', reason: 'must be a positive integer' }],
    });
    expect(await storedJob(id)).toMatchObject({ status: 'MAPPED' });
  });

  it('limits the preview to 20 rows and flags truncation', async () => {
    const { id } = await upload(ordersCsv(25));

    const res = await putMapping(id, MINIMAL_ORDER_MAPPING);

    expect(res.status).toBe(200);
    expect(res.body.data.preview.rows).toHaveLength(20);
    expect(res.body.data.preview.truncated).toBe(true);
    expect(res.body.data.preview.rows[19].rowNumber).toBe(20);
  });

  it('requires every required field to be mapped', async () => {
    const { id } = await upload(ORDERS_CSV);

    const res = await putMapping(id, {
      orderId: 'Order ID',
      orderedAt: 'Order Date',
      productName: 'Product',
      quantity: 'Qty',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([{ field: 'mapping.unitPrice', message: 'is required' }]),
    );
    expect(await storedJob(id)).toEqual({ status: 'UPLOADED', columnMapping: null });
  });

  it('rejects unknown fields, undetected headers and duplicate columns', async () => {
    const { id } = await upload(ORDERS_CSV);

    const unknown = await putMapping(id, { ...FULL_ORDER_MAPPING, foo: 'SKU' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'mapping.foo', message: 'is not a field for ORDERS imports' },
      ]),
    );

    const undetected = await putMapping(id, { ...FULL_ORDER_MAPPING, orderId: 'Missing Header' });
    expect(undetected.status).toBe(400);
    expect(undetected.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'mapping.orderId', message: 'must be one of the detected headers' },
      ]),
    );

    const duplicate = await putMapping(id, { ...FULL_ORDER_MAPPING, sku: 'Product' });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'mapping.sku', message: 'is already mapped to productName' },
      ]),
    );

    expect(await storedJob(id)).toEqual({ status: 'UPLOADED', columnMapping: null });
  });

  it('rejects mapping once processing has started', async () => {
    const { id } = await upload(ORDERS_CSV);
    await ctx.app
      .get(TenantPrismaService)
      .run(organizationId, (tx) =>
        tx.importJob.update({ where: { id }, data: { status: 'PROCESSING' } }),
      );

    const res = await putMapping(id, FULL_ORDER_MAPPING);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IMPORT_NOT_MAPPABLE');
    expect(await storedJob(id)).toEqual({ status: 'PROCESSING', columnMapping: null });
  });

  it('allows re-mapping an import that is already MAPPED', async () => {
    const { id } = await upload(ORDERS_CSV);

    expect((await putMapping(id, MINIMAL_ORDER_MAPPING)).status).toBe(200);
    const second = await putMapping(id, FULL_ORDER_MAPPING);

    expect(second.status).toBe(200);
    expect(second.body.data.mapping).toEqual(FULL_ORDER_MAPPING);
    expect(await storedJob(id)).toEqual({
      status: 'MAPPED',
      columnMapping: FULL_ORDER_MAPPING,
    });
  });

  it('maps a PRODUCTS upload with its optional fields omitted', async () => {
    const { id } = await upload('Name,SKU,Price\nWidget,SKU-1,9.99\n', 'PRODUCTS');

    const res = await putMapping(id, { name: 'Name' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      type: 'PRODUCTS',
      status: 'MAPPED',
      mapping: { name: 'Name', sku: null, price: null },
      preview: {
        truncated: false,
        rows: [
          {
            rowNumber: 1,
            values: { name: 'Widget', sku: null, price: null },
            valid: true,
            errors: [],
          },
        ],
      },
    });
  });

  it('cannot map an import belonging to another organization', async () => {
    const otherOrg = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Other Mapping Co' });
    expect(otherOrg.status).toBe(201);
    createdOrganizationIds.push(otherOrg.body.data.id);

    const other = await upload(ORDERS_CSV, 'ORDERS', otherOrg.body.data.id);
    const res = await putMapping(other.id, FULL_ORDER_MAPPING);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await storedJob(other.id, otherOrg.body.data.id)).toEqual({
      status: 'UPLOADED',
      columnMapping: null,
    });
  });

  it('returns 404 to an outsider and 400 or 404 for bad import ids', async () => {
    const { id } = await upload(ORDERS_CSV);

    const outsider = await registerUser(ctx.server, { email: uniqueEmail('mapping-outsider') });
    createdEmails.push(outsider.email);
    const outsiderSession = await loginUser(ctx.server, outsider);

    const outside = await putMapping(id, FULL_ORDER_MAPPING, {
      token: outsiderSession.accessToken,
    });
    expect(outside.status).toBe(404);
    expect(outside.body.error.code).toBe('NOT_FOUND');

    const invalid = await putMapping('not-a-uuid', FULL_ORDER_MAPPING);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');

    const missing = await putMapping('00000000-0000-4000-8000-000000000000', FULL_ORDER_MAPPING);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(await storedJob(id)).toEqual({ status: 'UPLOADED', columnMapping: null });
  });

  it('returns a safe 409 when the stored file is gone', async () => {
    const { id } = await upload(ORDERS_CSV);
    const storagePath = await ctx.app.get(TenantPrismaService).run(organizationId, async (tx) => {
      const job = await tx.importJob.findUniqueOrThrow({
        where: { id },
        select: { storagePath: true },
      });
      return job.storagePath;
    });
    await unlink(storagePath);

    const res = await putMapping(id, FULL_ORDER_MAPPING);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IMPORT_FILE_UNAVAILABLE');
    expect(await storedJob(id)).toEqual({ status: 'UPLOADED', columnMapping: null });
  });
});
