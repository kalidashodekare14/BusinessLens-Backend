import request from 'supertest';
import { Prisma } from '../../src/generated/prisma/client';
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

interface ItemSeed {
  productName: string;
  productId?: string;
  quantity: number;
  unitPrice: string;
}

describe('metrics overview (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  let widgetId: string;
  let gadgetId: string;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('metrics') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Metrics Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);

    ({ widgetId, gadgetId } = await seedCatalog(organizationId));
    await seedOrders(organizationId, widgetId, gadgetId);
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

  function endpoint(orgId = organizationId): string {
    return `/api/v1/organizations/${orgId}/metrics/overview`;
  }

  async function seedCatalog(orgId: string): Promise<{ widgetId: string; gadgetId: string }> {
    return ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const widget = await tx.product.create({
        data: { organizationId: orgId, name: 'Widget', sku: 'W-1', price: '10.00' },
        select: { id: true },
      });
      const gadget = await tx.product.create({
        data: { organizationId: orgId, name: 'Gadget', sku: 'G-1', price: '5.00' },
        select: { id: true },
      });
      return { widgetId: widget.id, gadgetId: gadget.id };
    });
  }

  async function createOrder(
    orgId: string,
    externalId: string,
    orderedAt: string,
    status: string,
    items: ItemSeed[],
  ): Promise<void> {
    const total = items
      .reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.unitPrice).times(item.quantity)),
        new Prisma.Decimal(0),
      )
      .toFixed(2);

    await ctx.app.get(TenantPrismaService).run(orgId, (tx) =>
      tx.order.create({
        data: {
          organizationId: orgId,
          externalId,
          orderedAt: new Date(orderedAt),
          status,
          total,
          items: {
            create: items.map((item) => ({
              organizationId: orgId,
              productId: item.productId ?? null,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: new Prisma.Decimal(item.unitPrice).times(item.quantity).toFixed(2),
            })),
          },
        },
      }),
    );
  }

  async function seedOrders(orgId: string, widget: string, gadget: string): Promise<void> {
    // Current period: 2026-09-01 .. 2026-09-30 inclusive.
    await createOrder(orgId, 'C-0', '2026-09-01T00:00:00.000Z', 'completed', [
      { productName: 'Gadget', productId: gadget, quantity: 1, unitPrice: '5.00' },
    ]);
    await createOrder(orgId, 'C-1', '2026-09-30T18:00:00.000Z', 'completed', [
      { productName: 'Widget', productId: widget, quantity: 2, unitPrice: '10.00' },
      { productName: 'Gadget', productId: gadget, quantity: 1, unitPrice: '5.00' },
    ]);
    await createOrder(orgId, 'C-EXCLUDED', '2026-09-15T12:00:00.000Z', 'CANCELLED', [
      { productName: 'Widget', productId: widget, quantity: 10, unitPrice: '10.00' },
    ]);

    // Previous period: 2026-08-02 .. 2026-08-31 inclusive.
    await createOrder(orgId, 'P-0', '2026-08-02T00:00:00.000Z', 'completed', [
      { productName: 'Widget', productId: widget, quantity: 1, unitPrice: '10.00' },
    ]);
    await createOrder(orgId, 'P-1', '2026-08-31T23:59:59.999Z', 'completed', [
      { productName: 'Widget', productId: widget, quantity: 1, unitPrice: '10.00' },
    ]);
    await createOrder(orgId, 'P-EXCLUDED', '2026-08-11T09:00:00.000Z', 'Refunded', [
      { productName: 'Gadget', productId: gadget, quantity: 4, unitPrice: '5.00' },
    ]);

    // A later excluded order must not move the reference date past 2026-09-30.
    await createOrder(orgId, 'LATE-EXCLUDED', '2026-10-15T09:00:00.000Z', 'cancelled', [
      { productName: 'Widget', productId: widget, quantity: 5, unitPrice: '10.00' },
    ]);
  }

  it('returns both periods, excludes cancelled/refunded orders and anchors on the latest non-excluded order', async () => {
    const res = await request(ctx.server).get(endpoint()).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      referenceDate: '2026-09-30T00:00:00.000Z',
      current: {
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-30T00:00:00.000Z',
        revenue: '30.00',
        orderCount: 2,
        averageOrderValue: '15.00',
        products: [
          { productId: widgetId, name: 'Widget', revenue: '20.00', units: 2 },
          { productId: gadgetId, name: 'Gadget', revenue: '10.00', units: 2 },
        ],
      },
      previous: {
        start: '2026-08-02T00:00:00.000Z',
        end: '2026-08-31T00:00:00.000Z',
        revenue: '20.00',
        orderCount: 2,
        averageOrderValue: '10.00',
        products: [{ productId: widgetId, name: 'Widget', revenue: '20.00', units: 2 }],
      },
      changes: { revenue: 50, orderCount: 0, averageOrderValue: 50 },
    });
  });

  it('returns 422 NO_ORDER_DATA when the organization has no usable orders', async () => {
    const empty = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Empty Metrics Co' });
    expect(empty.status).toBe(201);
    createdOrganizationIds.push(empty.body.data.id);

    const res = await request(ctx.server).get(endpoint(empty.body.data.id)).set(auth());

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: 'NO_ORDER_DATA',
      message: 'No order data is available for this organization.',
      details: [],
    });
  });

  it('returns 422 when every order is excluded', async () => {
    const org = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Excluded Metrics Co' });
    expect(org.status).toBe(201);
    createdOrganizationIds.push(org.body.data.id);
    await createOrder(org.body.data.id, 'ONLY-CANCELLED', '2026-09-10T09:00:00.000Z', 'voided', [
      { productName: 'Widget', quantity: 1, unitPrice: '10.00' },
    ]);

    const res = await request(ctx.server).get(endpoint(org.body.data.id)).set(auth());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_ORDER_DATA');
  });

  it('scopes tenant access and validates the organization id', async () => {
    const outsider = await registerUser(ctx.server, { email: uniqueEmail('metrics-outsider') });
    createdEmails.push(outsider.email);
    const outsiderSession = await loginUser(ctx.server, outsider);

    const outside = await request(ctx.server)
      .get(endpoint())
      .set(auth(outsiderSession.accessToken));
    expect(outside.status).toBe(404);
    expect(outside.body.error.code).toBe('NOT_FOUND');

    const invalid = await request(ctx.server)
      .get('/api/v1/organizations/not-a-uuid/metrics/overview')
      .set(auth());
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
  });
});
