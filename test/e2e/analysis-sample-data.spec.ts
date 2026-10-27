import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import request from 'supertest';
import { AnalysisProcessor } from '../../src/modules/analysis/analysis.processor';
import { ImportProcessor } from '../../src/modules/imports/imports.processor';
import { MetricsService } from '../../src/modules/metrics/metrics.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../src/queues/queue.constants';
import { QueueService } from '../../src/queues/queue.service';
import { TenantJobRunner } from '../../src/queues/tenant-job-runner';
import { deleteOrganizationsById, deleteUsersByEmail } from '../helpers/db';
import { loginUser, registerUser, uniqueEmail } from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const ORDER_MAPPING = {
  orderId: 'Order ID',
  orderedAt: 'Order Date',
  status: 'Status',
  productName: 'Product',
  sku: 'SKU',
  quantity: 'Qty',
  unitPrice: 'Unit Price',
};

describe('analysis on the sample dataset (e2e)', () => {
  let ctx: TestApp;
  let organizationId: string;
  let session: { accessToken: string };
  const email = uniqueEmail('sample-analysis');
  let storagePath: string | null = null;

  beforeAll(async () => {
    ctx = await createTestApp();
    const user = await registerUser(ctx.server, { email });
    session = await loginUser(ctx.server, user);
  });

  afterAll(async () => {
    const tenant = ctx.app.get(TenantPrismaService);
    if (organizationId) {
      await tenant.run(organizationId, (tx) =>
        tx.finding.deleteMany({ where: { organizationId } }),
      );
      await tenant.run(organizationId, (tx) =>
        tx.analysisRun.deleteMany({ where: { organizationId } }),
      );
      await tenant.run(organizationId, (tx) =>
        tx.orderItem.deleteMany({ where: { organizationId } }),
      );
      await tenant.run(organizationId, (tx) => tx.order.deleteMany({ where: { organizationId } }));
      await tenant.run(organizationId, (tx) =>
        tx.product.deleteMany({ where: { organizationId } }),
      );
      await tenant.run(organizationId, (tx) =>
        tx.importJob.deleteMany({ where: { organizationId } }),
      );
    }
    if (storagePath) {
      await unlink(storagePath).catch(() => undefined);
    }
    if (organizationId) {
      await deleteOrganizationsById(ctx.app, [organizationId]);
    }
    await deleteUsersByEmail(ctx.app, [email]);
    await ctx.close();
  });

  it('imports orders.csv and creates REVENUE_DROP, ORDER_COUNT_DROP and PRODUCT_REVENUE_DROP findings', async () => {
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    const queue = ctx.app.get(QueueService);
    const enqueueSpy = jest.spyOn(queue, 'enqueue').mockResolvedValue('queued-job-id');

    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth)
      .send({ name: 'Sample Data Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;

    const csv = await readFile(path.resolve('sample-data', 'orders.csv'));
    const upload = await request(ctx.server)
      .post(`/api/v1/organizations/${organizationId}/imports`)
      .set(auth)
      .field('type', 'ORDERS')
      .attach('file', csv, 'orders.csv');
    expect(upload.status).toBe(201);

    storagePath = await ctx.app.get(TenantPrismaService).run(organizationId, async (tx) => {
      const job = await tx.importJob.findUniqueOrThrow({
        where: { id: upload.body.data.id },
        select: { storagePath: true },
      });
      return job.storagePath;
    });

    const mapping = await request(ctx.server)
      .put(`/api/v1/organizations/${organizationId}/imports/${upload.body.data.id}/mapping`)
      .set(auth)
      .send({ mapping: ORDER_MAPPING });
    expect(mapping.status).toBe(200);

    const confirm = await request(ctx.server)
      .post(`/api/v1/organizations/${organizationId}/imports/${upload.body.data.id}/confirm`)
      .set(auth);
    expect(confirm.status).toBe(202);

    const importProcessor = new ImportProcessor(
      ctx.app.get(TenantJobRunner),
      ctx.app.get(TenantPrismaService),
      ctx.app.get(ConfigService),
    );
    await importProcessor.process({
      id: upload.body.data.id,
      name: JOB_NAMES.processImport,
      data: { organizationId, importJobId: upload.body.data.id },
    } as Job);

    const importJob = await ctx.app.get(TenantPrismaService).run(organizationId, (tx) =>
      tx.importJob.findUniqueOrThrow({
        where: { id: upload.body.data.id },
        select: { status: true, failedRows: true, processedRows: true },
      }),
    );
    expect(importJob.status).toBe('COMPLETED');
    expect(importJob.failedRows).toBe(0);
    expect(importJob.processedRows).toBeGreaterThan(1000);

    const runResponse = await request(ctx.server)
      .post(`/api/v1/organizations/${organizationId}/analysis-runs`)
      .set(auth);
    expect(runResponse.status).toBe(202);
    const runId = runResponse.body.data.id as string;

    const analysisProcessor = new AnalysisProcessor(
      ctx.app.get(TenantJobRunner),
      ctx.app.get(TenantPrismaService),
      ctx.app.get(MetricsService),
      queue,
    );
    await analysisProcessor.process({
      id: runId,
      name: JOB_NAMES.runAnalysis,
      data: { organizationId, analysisRunId: runId },
    } as Job);

    const tenant = ctx.app.get(TenantPrismaService);
    const run = await tenant.run(organizationId, (tx) =>
      tx.analysisRun.findUniqueOrThrow({
        where: { id: runId },
        select: { status: true, referenceDate: true, metricsSnapshot: true },
      }),
    );
    expect(run.status).toBe('COMPLETED');
    expect(run.referenceDate?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(run.metricsSnapshot).toMatchObject({
      current: { revenue: '26705.50', orderCount: 201, averageOrderValue: '132.86' },
      previous: { revenue: '39489.50', orderCount: 281, averageOrderValue: '140.53' },
    });

    const findings = await tenant.run(organizationId, (tx) =>
      tx.finding.findMany({
        where: { organizationId },
        select: { type: true, severity: true, title: true, evidence: true },
        orderBy: { type: 'asc' },
      }),
    );
    expect(findings.map((finding) => finding.type).sort()).toEqual([
      'ORDER_COUNT_DROP',
      'PRODUCT_REVENUE_DROP',
      'REVENUE_DROP',
    ]);
    const productFinding = findings.find((finding) => finding.type === 'PRODUCT_REVENUE_DROP');
    expect(productFinding?.title).toBe('Burr Grinder revenue dropped 88.1%');
    expect(productFinding?.severity).toBe('HIGH');
    expect(productFinding?.evidence).toMatchObject({
      metric: 'productRevenue',
      product: { name: 'Burr Grinder' },
      changePercent: -88.1,
      previous: { value: expect.any(String) },
      current: { value: expect.any(String) },
    });

    const revenueFinding = findings.find((finding) => finding.type === 'REVENUE_DROP');
    expect(revenueFinding?.evidence).toMatchObject({ changePercent: -32.4 });
    const orderFinding = findings.find((finding) => finding.type === 'ORDER_COUNT_DROP');
    expect(orderFinding?.evidence).toMatchObject({ changePercent: -28.5 });

    // The AI jobs are queued for each finding; the processor itself is Phase 5.
    const aiCalls = enqueueSpy.mock.calls.filter(
      ([queueName]) => queueName === QUEUE_NAMES.aiExplanation,
    );
    expect(aiCalls).toHaveLength(3);

    enqueueSpy.mockRestore();
  }, 120_000);
});
