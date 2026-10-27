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

describe('catalog read endpoints (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('catalog') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Catalog Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);
  });

  afterAll(async () => {
    const tenant = ctx.app.get(TenantPrismaService);
    for (const id of createdOrganizationIds) {
      await tenant.run(id, (tx) => tx.orderItem.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.order.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.product.deleteMany({ where: { organizationId: id } }));
    }
    await deleteOrganizationsById(ctx.app, createdOrganizationIds);
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  function auth(token = session.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  function endpoint(resource: 'products' | 'orders', orgId = organizationId): string {
    return `/api/v1/organizations/${orgId}/${resource}`;
  }

  async function createOrganization(name: string): Promise<string> {
    const res = await request(ctx.server).post('/api/v1/organizations').set(auth()).send({ name });
    expect(res.status).toBe(201);
    createdOrganizationIds.push(res.body.data.id);
    return res.body.data.id;
  }

  async function createOutsideUser(): Promise<LoginSession> {
    const outsider = await registerUser(ctx.server, { email: uniqueEmail('catalog-outsider') });
    createdEmails.push(outsider.email);
    return loginUser(ctx.server, outsider);
  }

  async function createProduct(
    orgId: string,
    data: { name: string; sku?: string | null; price?: string | null },
  ): Promise<string> {
    return ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: orgId,
          name: data.name,
          sku: data.sku ?? null,
          price: data.price ?? null,
        },
      });
      return product.id;
    });
  }

  async function createOrder(
    orgId: string,
    data: {
      externalId: string;
      orderedAt: Date;
      status?: string;
      total: string;
      itemCount?: number;
    },
  ): Promise<string> {
    return ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const order = await tx.order.create({
        data: {
          organizationId: orgId,
          externalId: data.externalId,
          orderedAt: data.orderedAt,
          status: data.status ?? 'completed',
          total: data.total,
          items: {
            create: Array.from({ length: data.itemCount ?? 1 }, (_, index) => ({
              organizationId: orgId,
              productName: `${data.externalId} item ${index + 1}`,
              quantity: 1,
              unitPrice: '1.00',
              lineTotal: '1.00',
            })),
          },
        },
      });
      return order.id;
    });
  }

  describe('GET /products', () => {
    it('lists products by name with money as strings and pagination meta', async () => {
      await createProduct(organizationId, { name: 'Beta', sku: 'SKU-B', price: '12.50' });
      await createProduct(organizationId, { name: 'Alpha', sku: 'SKU-A', price: '1.5' });
      await createProduct(organizationId, { name: 'Gamma' });

      const first = await request(ctx.server)
        .get(`${endpoint('products')}?page=1&pageSize=2`)
        .set(auth());
      expect(first.status).toBe(200);
      expect(first.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
      expect(first.body.data).toEqual([
        { id: expect.any(String), name: 'Alpha', sku: 'SKU-A', price: '1.50' },
        { id: expect.any(String), name: 'Beta', sku: 'SKU-B', price: '12.50' },
      ]);

      const second = await request(ctx.server)
        .get(`${endpoint('products')}?page=2&pageSize=2`)
        .set(auth());
      expect(second.status).toBe(200);
      expect(second.body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
      expect(second.body.data).toEqual([
        { id: expect.any(String), name: 'Gamma', sku: null, price: null },
      ]);
    });

    it('rejects invalid pagination', async () => {
      const res = await request(ctx.server)
        .get(`${endpoint('products')}?page=0`)
        .set(auth());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');

      const tooLarge = await request(ctx.server)
        .get(`${endpoint('products')}?pageSize=101`)
        .set(auth());
      expect(tooLarge.status).toBe(400);
      expect(tooLarge.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('never returns another organization’s products', async () => {
      await createProduct(organizationId, { name: 'Mine' });
      const otherOrgId = await createOrganization('Other Catalog Co');
      await createProduct(otherOrgId, { name: 'Foreign' });

      const own = await request(ctx.server).get(endpoint('products')).set(auth());
      expect(own.status).toBe(200);
      expect(own.body.data.map((product: { name: string }) => product.name)).toEqual(['Mine']);

      const other = await request(ctx.server).get(endpoint('products', otherOrgId)).set(auth());
      expect(other.status).toBe(200);
      expect(other.body.data.map((product: { name: string }) => product.name)).toEqual(['Foreign']);

      const outsider = await createOutsideUser();
      const denied = await request(ctx.server)
        .get(endpoint('products'))
        .set(auth(outsider.accessToken));
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /orders', () => {
    const early = new Date('2026-01-01T00:00:00.000Z');
    const middle = new Date('2026-01-15T00:00:00.000Z');
    const late = new Date('2026-02-01T00:00:00.000Z');

    it('lists orders newest first with totals and item counts', async () => {
      await createOrder(organizationId, {
        externalId: 'ORD-1',
        orderedAt: early,
        total: '10.00',
        itemCount: 2,
      });
      await createOrder(organizationId, {
        externalId: 'ORD-2',
        orderedAt: middle,
        total: '20.50',
        status: 'cancelled',
      });
      await createOrder(organizationId, { externalId: 'ORD-3', orderedAt: late, total: '30' });

      const res = await request(ctx.server)
        .get(`${endpoint('orders')}?page=1&pageSize=2`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
      expect(res.body.data).toEqual([
        {
          id: expect.any(String),
          externalId: 'ORD-3',
          orderedAt: '2026-02-01T00:00:00.000Z',
          status: 'completed',
          total: '30.00',
          itemCount: 1,
        },
        {
          id: expect.any(String),
          externalId: 'ORD-2',
          orderedAt: '2026-01-15T00:00:00.000Z',
          status: 'cancelled',
          total: '20.50',
          itemCount: 1,
        },
      ]);
    });

    it('filters by an inclusive date range', async () => {
      await createOrder(organizationId, { externalId: 'ORD-1', orderedAt: early, total: '10.00' });
      await createOrder(organizationId, { externalId: 'ORD-2', orderedAt: middle, total: '20.00' });
      await createOrder(organizationId, { externalId: 'ORD-3', orderedAt: late, total: '30.00' });

      const inclusive = await request(ctx.server)
        .get(`${endpoint('orders')}?from=2026-01-15T00:00:00.000Z&to=2026-02-01T00:00:00.000Z`)
        .set(auth());
      expect(inclusive.status).toBe(200);
      expect(inclusive.body.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
      expect(inclusive.body.data.map((order: { externalId: string }) => order.externalId)).toEqual([
        'ORD-3',
        'ORD-2',
      ]);

      const upperOnly = await request(ctx.server)
        .get(`${endpoint('orders')}?to=2026-01-31T23:59:59.999Z`)
        .set(auth());
      expect(upperOnly.status).toBe(200);
      expect(upperOnly.body.data.map((order: { externalId: string }) => order.externalId)).toEqual([
        'ORD-2',
        'ORD-1',
      ]);

      const lowerOnly = await request(ctx.server)
        .get(`${endpoint('orders')}?from=2026-01-02T00:00:00.000Z`)
        .set(auth());
      expect(lowerOnly.status).toBe(200);
      expect(lowerOnly.body.data.map((order: { externalId: string }) => order.externalId)).toEqual([
        'ORD-3',
        'ORD-2',
      ]);
    });

    it('rejects an inverted or malformed range', async () => {
      const inverted = await request(ctx.server)
        .get(`${endpoint('orders')}?from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z`)
        .set(auth());
      expect(inverted.status).toBe(400);
      expect(inverted.body.error.code).toBe('VALIDATION_FAILED');

      const malformed = await request(ctx.server)
        .get(`${endpoint('orders')}?from=not-a-date`)
        .set(auth());
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('never returns another organization’s orders', async () => {
      await createOrder(organizationId, { externalId: 'MINE-1', orderedAt: early, total: '10.00' });
      const otherOrgId = await createOrganization('Other Orders Catalog');
      await createOrder(otherOrgId, { externalId: 'FOREIGN-1', orderedAt: early, total: '10.00' });

      const own = await request(ctx.server).get(endpoint('orders')).set(auth());
      expect(own.status).toBe(200);
      expect(own.body.data.map((order: { externalId: string }) => order.externalId)).toEqual([
        'MINE-1',
      ]);

      const outsider = await createOutsideUser();
      const denied = await request(ctx.server)
        .get(endpoint('orders'))
        .set(auth(outsider.accessToken));
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('NOT_FOUND');
    });
  });
});
