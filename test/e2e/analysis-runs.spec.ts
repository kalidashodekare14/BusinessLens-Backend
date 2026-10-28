import request from 'supertest';
import type { Job } from 'bullmq';
import { AnalysisProcessor } from '../../src/modules/analysis/analysis.processor';
import { AuditAction } from '../../src/modules/audit/audit.actions';
import { AuditService } from '../../src/modules/audit/audit.service';
import { MetricsService } from '../../src/modules/metrics/metrics.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../src/queues/queue.constants';
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

interface SeedOptions {
  previousOrders?: number;
  currentOrders?: number;
  previousAmount?: string;
  currentAmount?: string;
}

const ANALYSIS_RUN = (runId: string, organizationId: string): Job =>
  ({
    id: runId,
    name: JOB_NAMES.runAnalysis,
    data: { organizationId, analysisRunId: runId },
  }) as Job;

function utcDay(month: number, day: number): Date {
  return new Date(Date.UTC(2026, month, day));
}

describe('analysis runs (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  let queueSpy: jest.SpyInstance;
  let recordSpy: jest.SpyInstance;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('analysis') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Analysis Co' });
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
      await tenant.run(id, (tx) => tx.finding.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.analysisRun.deleteMany({ where: { organizationId: id } }));
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
    return `/api/v1/organizations/${orgId}/analysis-runs`;
  }

  async function seedOrders(orgId: string, options: SeedOptions = {}): Promise<void> {
    const previousOrders = options.previousOrders ?? 20;
    const currentOrders = options.currentOrders ?? 10;
    const previousAmount = options.previousAmount ?? '100.00';
    const currentAmount = options.currentAmount ?? '50.00';

    await ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const widget = await tx.product.create({
        data: { organizationId: orgId, name: 'Widget', sku: 'W-1', price: previousAmount },
        select: { id: true },
      });

      const createOrder = async (
        externalId: string,
        orderedAt: Date,
        amount: string,
      ): Promise<void> => {
        await tx.order.create({
          data: {
            organizationId: orgId,
            externalId,
            orderedAt,
            status: 'completed',
            total: amount,
            items: {
              create: [
                {
                  organizationId: orgId,
                  productId: widget.id,
                  productName: 'Widget',
                  quantity: 1,
                  unitPrice: amount,
                  lineTotal: amount,
                },
              ],
            },
          },
        });
      };

      for (let index = 0; index < previousOrders; index += 1) {
        const day = 2 + Math.floor((index * 29) / Math.max(1, previousOrders - 1));
        await createOrder(`P-${index + 1}`, utcDay(7, day), previousAmount);
      }

      for (let index = 0; index < currentOrders; index += 1) {
        const day = 1 + Math.floor((index * 29) / Math.max(1, currentOrders - 1));
        await createOrder(`C-${index + 1}`, utcDay(8, day), currentAmount);
      }
    });
  }

  async function createRun(orgId = organizationId) {
    const res = await request(ctx.server).post(endpoint(orgId)).set(auth());
    expect(res.status).toBe(202);
    return res.body.data as { id: string; status: string; createdAt: string };
  }

  async function storedRun(runId: string, orgId = organizationId) {
    return ctx.app.get(TenantPrismaService).run(orgId, (tx) =>
      tx.analysisRun.findUnique({
        where: { id: runId },
        select: {
          status: true,
          referenceDate: true,
          currentStart: true,
          currentEnd: true,
          previousStart: true,
          previousEnd: true,
          metricsSnapshot: true,
          errorMessage: true,
          completedAt: true,
        },
      }),
    );
  }

  async function storedFindings(orgId = organizationId) {
    return ctx.app.get(TenantPrismaService).run(orgId, (tx) =>
      tx.finding.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'asc' },
        select: {
          type: true,
          severity: true,
          title: true,
          subjectKey: true,
          evidence: true,
          ruleVersion: true,
          status: true,
        },
      }),
    );
  }

  function newProcessor(metrics = ctx.app.get(MetricsService)): AnalysisProcessor {
    return new AnalysisProcessor(
      ctx.app.get(TenantJobRunner),
      ctx.app.get(TenantPrismaService),
      metrics,
      ctx.app.get(QueueService),
    );
  }

  async function runProcessor(runId: string, orgId = organizationId): Promise<void> {
    await newProcessor().process(ANALYSIS_RUN(runId, orgId));
  }

  describe('POST /analysis-runs', () => {
    it('creates a QUEUED run, enqueues it and records an audit event', async () => {
      const run = await createRun();

      expect(run.status).toBe('QUEUED');
      expect(queueSpy).toHaveBeenCalledWith(
        QUEUE_NAMES.analysis,
        JOB_NAMES.runAnalysis,
        { organizationId, analysisRunId: run.id },
        { jobId: run.id },
      );
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ANALYSIS_STARTED,
          actorId: user.id,
          organizationId,
          entityType: 'AnalysisRun',
          entityId: run.id,
        }),
      );
      expect(await storedRun(run.id)).toMatchObject({ status: 'QUEUED' });
    });

    it('marks the run FAILED and returns 503 when Redis cannot accept the job', async () => {
      queueSpy.mockRejectedValueOnce(new Error('redis unavailable'));

      const res = await request(ctx.server).post(endpoint()).set(auth());

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('ANALYSIS_QUEUE_UNAVAILABLE');

      const tenant = ctx.app.get(TenantPrismaService);
      const failed = await tenant.run(organizationId, (tx) =>
        tx.analysisRun.findFirstOrThrow({
          where: { organizationId },
          select: { status: true, errorMessage: true, completedAt: true },
        }),
      );
      expect(failed.status).toBe('FAILED');
      expect(failed.errorMessage).toBe('The analysis could not be queued.');
      expect(failed.completedAt).not.toBeNull();
    });

    it('scopes runs to the organization and validates ids', async () => {
      const outsider = await registerUser(ctx.server, { email: uniqueEmail('analysis-outsider') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);

      const outside = await request(ctx.server)
        .post(endpoint())
        .set(auth(outsiderSession.accessToken));
      expect(outside.status).toBe(404);
      expect(outside.body.error.code).toBe('NOT_FOUND');

      const invalid = await request(ctx.server)
        .post('/api/v1/organizations/not-a-uuid/analysis-runs')
        .set(auth());
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
      expect(queueSpy).not.toHaveBeenCalled();
    });
  });

  describe('GET /analysis-runs and /:runId', () => {
    it('lists runs newest first with pagination metadata', async () => {
      const first = await createRun();
      await ctx.app.get(TenantPrismaService).run(organizationId, (tx) =>
        tx.analysisRun.update({
          where: { id: first.id },
          data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
        }),
      );
      const second = await createRun();

      const res = await request(ctx.server).get(`${endpoint()}?page=1&pageSize=1`).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(second.id);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 1, total: 2 });

      const pageTwo = await request(ctx.server).get(`${endpoint()}?page=2&pageSize=1`).set(auth());
      expect(pageTwo.body.data[0].id).toBe(first.id);
    });

    it('scopes the list to the organization and rejects outsiders', async () => {
      const ownRun = await createRun();

      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other List Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherRun = await createRun(otherOrg.body.data.id);

      const list = await request(ctx.server).get(endpoint()).set(auth());
      expect(list.status).toBe(200);
      expect(list.body.data.map((run: { id: string }) => run.id)).toEqual([ownRun.id]);
      expect(list.body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });

      const otherList = await request(ctx.server).get(endpoint(otherOrg.body.data.id)).set(auth());
      expect(otherList.body.data.map((run: { id: string }) => run.id)).toEqual([otherRun.id]);

      const outsider = await registerUser(ctx.server, { email: uniqueEmail('analysis-list-out') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);
      const outside = await request(ctx.server)
        .get(endpoint())
        .set(auth(outsiderSession.accessToken));
      expect(outside.status).toBe(404);
      expect(outside.body.error.code).toBe('NOT_FOUND');
    });

    it('returns the run detail and 404 for missing, cross-organization and outsider ids', async () => {
      const run = await createRun();

      const detail = await request(ctx.server).get(`${endpoint()}/${run.id}`).set(auth());
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        id: run.id,
        status: 'QUEUED',
        metricsSnapshot: null,
        errorMessage: null,
      });

      const missing = await request(ctx.server)
        .get(`${endpoint()}/00000000-0000-4000-8000-000000000000`)
        .set(auth());
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');

      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Analysis Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherRun = await createRun(otherOrg.body.data.id);

      const crossOrg = await request(ctx.server).get(`${endpoint()}/${otherRun.id}`).set(auth());
      expect(crossOrg.status).toBe(404);
      expect(crossOrg.body.error.code).toBe('NOT_FOUND');

      const outsider = await registerUser(ctx.server, { email: uniqueEmail('analysis-detail') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);
      const outside = await request(ctx.server)
        .get(`${endpoint()}/${run.id}`)
        .set(auth(outsiderSession.accessToken));
      expect(outside.status).toBe(404);
      expect(outside.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects an invalid run id', async () => {
      const res = await request(ctx.server).get(`${endpoint()}/not-a-uuid`).set(auth());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('analysis worker', () => {
    it('completes a run, stores periods and metrics, and creates findings for all three rules', async () => {
      await seedOrders(organizationId);
      const run = await createRun();
      queueSpy.mockClear();

      await runProcessor(run.id);

      const stored = await storedRun(run.id);
      expect(stored).toMatchObject({
        status: 'COMPLETED',
        referenceDate: new Date('2026-09-30T00:00:00.000Z'),
        currentStart: new Date('2026-09-01T00:00:00.000Z'),
        currentEnd: new Date('2026-09-30T00:00:00.000Z'),
        previousStart: new Date('2026-08-02T00:00:00.000Z'),
        previousEnd: new Date('2026-08-31T00:00:00.000Z'),
        errorMessage: null,
      });
      expect(stored?.completedAt).not.toBeNull();
      expect(stored?.metricsSnapshot).toEqual({
        version: 1,
        referenceDate: '2026-09-30T00:00:00.000Z',
        current: {
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-30T00:00:00.000Z',
          revenue: '500.00',
          orderCount: 10,
          averageOrderValue: '50.00',
          products: [
            { productId: expect.any(String), name: 'Widget', revenue: '500.00', units: 10 },
          ],
        },
        previous: {
          start: '2026-08-02T00:00:00.000Z',
          end: '2026-08-31T00:00:00.000Z',
          revenue: '2000.00',
          orderCount: 20,
          averageOrderValue: '100.00',
          products: [
            { productId: expect.any(String), name: 'Widget', revenue: '2000.00', units: 20 },
          ],
        },
      });

      const findings = await storedFindings();
      expect(findings.map((finding) => finding.type).sort()).toEqual([
        'ORDER_COUNT_DROP',
        'PRODUCT_REVENUE_DROP',
        'REVENUE_DROP',
      ]);
      expect(findings.every((finding) => finding.severity === 'HIGH')).toBe(true);
      expect(findings.every((finding) => finding.status === 'OPEN')).toBe(true);
      expect(findings.map((finding) => finding.ruleVersion).sort()).toEqual([
        'order-count-drop-v1',
        'product-revenue-drop-v1',
        'revenue-drop-v1',
      ]);
      const productFinding = findings.find((finding) => finding.type === 'PRODUCT_REVENUE_DROP');
      expect(productFinding?.subjectKey).toEqual(expect.any(String));
      expect(productFinding?.title).toBe('Widget revenue dropped 75.0%');

      // One AI job per finding, queued only after the run committed.
      const aiCalls = queueSpy.mock.calls.filter(
        ([queueName]) => queueName === QUEUE_NAMES.aiExplanation,
      );
      expect(aiCalls).toHaveLength(3);
      for (const [, jobName, payload] of aiCalls) {
        expect(jobName).toBe(JOB_NAMES.generateExplanation);
        expect(payload).toEqual({
          organizationId,
          findingId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
        });
      }
    });

    it('is a no-op on duplicate delivery', async () => {
      await seedOrders(organizationId);
      const run = await createRun();

      await runProcessor(run.id);
      await runProcessor(run.id);

      expect(await storedFindings()).toHaveLength(3);
      expect((await storedRun(run.id))?.status).toBe('COMPLETED');
    });

    it('fails a run when the organization has no orders', async () => {
      const empty = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Empty Analysis Co' });
      expect(empty.status).toBe(201);
      createdOrganizationIds.push(empty.body.data.id);
      const run = await createRun(empty.body.data.id);

      await runProcessor(run.id, empty.body.data.id);

      expect(await storedRun(run.id, empty.body.data.id)).toMatchObject({
        status: 'FAILED',
        errorMessage: 'No orders available to analyze.',
        metricsSnapshot: null,
      });
      expect(await storedFindings(empty.body.data.id)).toHaveLength(0);
    });

    it('completes with no findings when the previous period has fewer than 20 orders', async () => {
      await seedOrders(organizationId, { previousOrders: 5, currentOrders: 2 });
      const run = await createRun();

      await runProcessor(run.id);

      expect((await storedRun(run.id))?.status).toBe('COMPLETED');
      expect(await storedFindings()).toHaveLength(0);
    });

    it('stores a safe failure message and no findings when metric computation throws', async () => {
      await seedOrders(organizationId);
      const run = await createRun();
      const metrics = ctx.app.get(MetricsService);
      const spy = jest
        .spyOn(metrics, 'computeWithinTransaction')
        .mockRejectedValueOnce(new Error('database connection details'));

      await expect(runProcessor(run.id)).rejects.toThrow('Analysis failed.');

      spy.mockRestore();
      expect(await storedRun(run.id)).toMatchObject({
        status: 'FAILED',
        errorMessage: 'Analysis failed.',
        metricsSnapshot: null,
      });
      expect(await storedFindings()).toHaveLength(0);
    });

    it('keeps the run COMPLETED when AI jobs cannot be queued', async () => {
      await seedOrders(organizationId);
      const run = await createRun();
      queueSpy.mockImplementation((queueName: string) =>
        queueName === QUEUE_NAMES.aiExplanation
          ? Promise.reject(new Error('redis unavailable'))
          : Promise.resolve('queued-job-id'),
      );

      await runProcessor(run.id);

      expect((await storedRun(run.id))?.status).toBe('COMPLETED');
      expect(await storedFindings()).toHaveLength(3);
    });

    it('cannot process another organization’s run with its own payload', async () => {
      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Worker Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherOrgId = otherOrg.body.data.id as string;

      const otherRun = await createRun(otherOrgId);

      await expect(runProcessor(otherRun.id)).rejects.toThrow('Analysis run not found.');

      expect(await storedRun(otherRun.id, otherOrgId)).toMatchObject({ status: 'QUEUED' });
      expect(await storedFindings(otherOrgId)).toHaveLength(0);
    });

    it('rejects a job payload without a valid run id', async () => {
      const processor = newProcessor();

      await expect(
        processor.process({
          id: 'x',
          name: JOB_NAMES.runAnalysis,
          data: { organizationId },
        } as Job),
      ).rejects.toThrow('Job payload is missing a valid analysisRunId.');
    });
  });
});
