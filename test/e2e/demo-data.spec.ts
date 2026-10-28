import { unlink } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import request from 'supertest';
import { AuditAction } from '../../src/modules/audit/audit.actions';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ImportProcessor } from '../../src/modules/imports/imports.processor';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { JOB_NAMES } from '../../src/queues/queue.constants';
import { QueueService } from '../../src/queues/queue.service';
import { TenantJobRunner } from '../../src/queues/tenant-job-runner';
import { deleteOrganizationsById, deleteUsersByEmail } from '../helpers/db';
import {
  loginUser,
  registerUser,
  uniqueEmail,
  type LoginSession,
  type RegisteredUser,
} from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

describe('demo data (e2e)', () => {
  let ctx: TestApp;
  let owner: RegisteredUser;
  let ownerSession: LoginSession;
  let outsider: RegisteredUser;
  let outsiderSession: LoginSession;
  let organizationId: string;
  let queueSpy: jest.SpyInstance;
  let recordSpy: jest.SpyInstance;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];
  const storagePaths: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx.server, { email: uniqueEmail('demo-owner') });
    outsider = await registerUser(ctx.server, { email: uniqueEmail('demo-outsider') });
    createdEmails.push(owner.email, outsider.email);
    ownerSession = await loginUser(ctx.server, owner);
    outsiderSession = await loginUser(ctx.server, outsider);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Demo Co' });
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

  function auth(token = ownerSession.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  function endpoint(orgId = organizationId): string {
    return `/api/v1/organizations/${orgId}/demo-data`;
  }

  async function storedImports(orgId = organizationId) {
    return ctx.app.get(TenantPrismaService).run(orgId, (tx) =>
      tx.importJob.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          status: true,
          detectedHeaders: true,
          columnMapping: true,
          storagePath: true,
        },
      }),
    );
  }

  async function runProcessor(importJobId: string, orgId = organizationId): Promise<void> {
    const processor = new ImportProcessor(
      ctx.app.get(TenantJobRunner),
      ctx.app.get(TenantPrismaService),
      ctx.app.get(ConfigService),
    );
    await processor.process({
      id: importJobId,
      name: JOB_NAMES.processImport,
      data: { organizationId: orgId, importJobId },
    } as Job);
  }

  it('rejects requests without a token', async () => {
    const res = await request(ctx.server).post(endpoint());
    expect(res.status).toBe(401);
  });

  it('returns 404 to an outsider so the route is not confirmed to them', async () => {
    const res = await request(ctx.server).post(endpoint()).set(auth(outsiderSession.accessToken));
    expect(res.status).toBe(404);
    expect((await storedImports()).length).toBe(0);
  });

  it('rejects a MEMBER with 403', async () => {
    const member = await registerUser(ctx.server, { email: uniqueEmail('demo-member') });
    createdEmails.push(member.email);
    const memberSession = await loginUser(ctx.server, member);
    await ctx.app.get(PrismaService).membership.create({
      data: { userId: member.id, organizationId, role: 'MEMBER' },
    });

    const res = await request(ctx.server).post(endpoint()).set(auth(memberSession.accessToken));
    expect(res.status).toBe(403);
    expect((await storedImports()).length).toBe(0);
  });

  it('loads both sample files through the import pipeline and audits every step', async () => {
    const res = await request(ctx.server).post(endpoint()).set(auth());

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('PROCESSING');
    expect(res.body.data.imports).toHaveLength(2);
    expect(res.body.data.imports.map((entry: { type: string }) => entry.type)).toEqual([
      'PRODUCTS',
      'ORDERS',
    ]);

    const jobs = await storedImports();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.status)).toEqual(['PROCESSING', 'PROCESSING']);
    // The mapping step really ran: headers were detected from the real sample
    // files and the validated mapping was stored before confirm.
    expect(jobs[0].detectedHeaders).toEqual(['Name', 'SKU', 'Price']);
    expect(jobs[1].detectedHeaders).toEqual([
      'Order ID',
      'Order Date',
      'Status',
      'Product',
      'SKU',
      'Qty',
      'Unit Price',
    ]);
    expect(jobs[0].columnMapping).toMatchObject({ name: 'Name', sku: 'SKU', price: 'Price' });
    expect(jobs[1].columnMapping).toMatchObject({
      orderId: 'Order ID',
      orderedAt: 'Order Date',
      productName: 'Product',
      quantity: 'Qty',
      unitPrice: 'Unit Price',
    });
    storagePaths.push(...jobs.map((job) => job.storagePath));

    expect(queueSpy).toHaveBeenCalledTimes(2);
    for (const call of queueSpy.mock.calls) {
      expect(call[0]).toBe('import-processing');
    }

    const actions = recordSpy.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions.filter((action) => action === AuditAction.IMPORT_UPLOADED)).toHaveLength(2);
    expect(actions.filter((action) => action === AuditAction.IMPORT_CONFIRMED)).toHaveLength(2);
    const demoEvents = recordSpy.mock.calls
      .map((call) => call[0] as { action: string; metadata?: { importIds?: string[] } })
      .filter((event) => event.action === AuditAction.DEMO_DATA_LOADED);
    expect(demoEvents).toHaveLength(1);
    expect(demoEvents[0].metadata?.importIds).toEqual(jobs.map((job) => job.id));
  });

  it('imports the sample dataset when the queued jobs run', async () => {
    const res = await request(ctx.server).post(endpoint()).set(auth());
    expect(res.status).toBe(202);

    const jobs = await storedImports();
    for (const job of jobs) {
      await runProcessor(job.id);
    }

    const finished = await storedImports();
    expect(finished.map((job) => job.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(finished.every((job) => job.columnMapping !== null)).toBe(true);

    const tenant = ctx.app.get(TenantPrismaService);
    const counts = await tenant.run(organizationId, async (tx) => ({
      orders: await tx.order.count({ where: { organizationId } }),
      orderItems: await tx.orderItem.count({ where: { organizationId } }),
      products: await tx.product.count({ where: { organizationId } }),
    }));
    // products.csv has 6 rows; the ORDERS import links or creates the rest.
    expect(counts.products).toBeGreaterThanOrEqual(6);
    expect(counts.orders).toBeGreaterThan(1000);
    expect(counts.orderItems).toBeGreaterThan(1000);
  }, 60_000);
});
