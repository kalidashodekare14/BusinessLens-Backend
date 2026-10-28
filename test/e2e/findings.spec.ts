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

interface FindingFixture {
  analysisRunId: string;
  revenueFindingId: string;
  orderCountFindingId: string;
  productFindingId: string;
  noteId: string;
}

const EVIDENCE = {
  metric: 'revenue',
  current: { value: '80.00', start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' },
  previous: {
    value: '100.00',
    start: '2026-08-02T00:00:00.000Z',
    end: '2026-08-31T00:00:00.000Z',
  },
  changePercent: -20,
  thresholds: { trigger: -10, high: -20 },
  relatedMetrics: {
    orderCount: { current: 10, previous: 20, changePercent: -50 },
    averageOrderValue: { current: '8.00', previous: '5.00', changePercent: 60 },
  },
};

describe('findings (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  let fixture: FindingFixture;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('findings') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Findings Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);
    fixture = await seedFindings(organizationId);
  });

  afterAll(async () => {
    const tenant = ctx.app.get(TenantPrismaService);
    for (const id of createdOrganizationIds) {
      await tenant.run(id, (tx) => tx.aiExplanation.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.findingNote.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.finding.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.analysisRun.deleteMany({ where: { organizationId: id } }));
    }
    await deleteOrganizationsById(ctx.app, createdOrganizationIds);
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  function auth(token = session.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  function endpoint(orgId = organizationId): string {
    return `/api/v1/organizations/${orgId}/findings`;
  }

  async function seedFindings(orgId: string): Promise<FindingFixture> {
    return ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const run = await tx.analysisRun.create({
        data: {
          organizationId: orgId,
          triggeredById: user.id,
          status: 'COMPLETED',
          completedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        select: { id: true },
      });

      const base = {
        organizationId: orgId,
        analysisRunId: run.id,
        ruleVersion: 'test-v1',
        evidence: EVIDENCE as unknown as Prisma.InputJsonValue,
      };

      const revenue = await tx.finding.create({
        data: {
          ...base,
          type: 'REVENUE_DROP',
          severity: 'HIGH',
          status: 'OPEN',
          title: 'Revenue dropped 20.0%',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        select: { id: true },
      });

      const orderCount = await tx.finding.create({
        data: {
          ...base,
          type: 'ORDER_COUNT_DROP',
          severity: 'MEDIUM',
          status: 'INVESTIGATING',
          title: 'Order count dropped 10.0%',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
        select: { id: true },
      });

      const product = await tx.finding.create({
        data: {
          ...base,
          type: 'PRODUCT_REVENUE_DROP',
          severity: 'HIGH',
          status: 'RESOLVED',
          title: 'Widget revenue dropped 60.0%',
          subjectKey: 'product-1',
          createdAt: new Date('2026-01-03T00:00:00.000Z'),
          resolvedAt: new Date('2026-01-04T00:00:00.000Z'),
        },
        select: { id: true },
      });

      const note = await tx.findingNote.create({
        data: {
          organizationId: orgId,
          findingId: revenue.id,
          authorId: user.id,
          body: 'Check the pricing change.',
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
        },
        select: { id: true },
      });

      await tx.aiExplanation.create({
        data: {
          organizationId: orgId,
          findingId: revenue.id,
          status: 'COMPLETED',
          model: 'fake-model',
          content: { summary: 'Revenue fell.' } as unknown as Prisma.InputJsonValue,
          validationPassed: true,
          attempts: 1,
        },
      });

      return {
        analysisRunId: run.id,
        revenueFindingId: revenue.id,
        orderCountFindingId: orderCount.id,
        productFindingId: product.id,
        noteId: note.id,
      };
    });
  }

  describe('GET /findings', () => {
    it('lists findings newest first', async () => {
      const res = await request(ctx.server).get(endpoint()).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data.map((finding: { id: string }) => finding.id)).toEqual([
        fixture.productFindingId,
        fixture.orderCountFindingId,
        fixture.revenueFindingId,
      ]);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 3 });
      expect(res.body.data[0]).toMatchObject({
        type: 'PRODUCT_REVENUE_DROP',
        severity: 'HIGH',
        status: 'RESOLVED',
        subjectKey: 'product-1',
      });
      expect(res.body.data[0]).not.toHaveProperty('evidence');
    });

    it('filters by status, severity, type and analysisRunId', async () => {
      const open = await request(ctx.server).get(`${endpoint()}?status=OPEN`).set(auth());
      expect(open.body.data.map((finding: { id: string }) => finding.id)).toEqual([
        fixture.revenueFindingId,
      ]);

      const high = await request(ctx.server).get(`${endpoint()}?severity=HIGH`).set(auth());
      expect(high.body.data.map((finding: { id: string }) => finding.id)).toEqual([
        fixture.productFindingId,
        fixture.revenueFindingId,
      ]);

      const type = await request(ctx.server).get(`${endpoint()}?type=ORDER_COUNT_DROP`).set(auth());
      expect(type.body.data.map((finding: { id: string }) => finding.id)).toEqual([
        fixture.orderCountFindingId,
      ]);

      const run = await request(ctx.server)
        .get(`${endpoint()}?analysisRunId=${fixture.analysisRunId}`)
        .set(auth());
      expect(run.body.meta.total).toBe(3);

      const combined = await request(ctx.server)
        .get(`${endpoint()}?severity=HIGH&status=OPEN`)
        .set(auth());
      expect(combined.body.meta.total).toBe(1);
      expect(combined.body.data[0].id).toBe(fixture.revenueFindingId);
    });

    it('paginates with page and pageSize', async () => {
      const first = await request(ctx.server).get(`${endpoint()}?page=1&pageSize=1`).set(auth());
      expect(first.body.data).toHaveLength(1);
      expect(first.body.data[0].id).toBe(fixture.productFindingId);
      expect(first.body.meta).toEqual({ page: 1, pageSize: 1, total: 3 });

      const second = await request(ctx.server).get(`${endpoint()}?page=2&pageSize=1`).set(auth());
      expect(second.body.data[0].id).toBe(fixture.orderCountFindingId);
    });

    it('returns an empty page for another organization’s analysis run id', async () => {
      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Findings Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherFixture = await seedFindings(otherOrg.body.data.id);

      const res = await request(ctx.server)
        .get(`${endpoint()}?analysisRunId=${otherFixture.analysisRunId}`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('rejects invalid filters and pagination', async () => {
      for (const query of [
        'status=BOGUS',
        'severity=CRITICAL',
        'type=SOMETHING_ELSE',
        'analysisRunId=not-a-uuid',
        'page=0',
        'pageSize=101',
      ]) {
        const res = await request(ctx.server).get(`${endpoint()}?${query}`).set(auth());
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('requires membership of the organization', async () => {
      const outsider = await registerUser(ctx.server, { email: uniqueEmail('findings-outsider') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);

      const res = await request(ctx.server).get(endpoint()).set(auth(outsiderSession.accessToken));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /findings/:findingId', () => {
    it('returns evidence, notes and the explanation', async () => {
      const res = await request(ctx.server)
        .get(`${endpoint()}/${fixture.revenueFindingId}`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: fixture.revenueFindingId,
        type: 'REVENUE_DROP',
        severity: 'HIGH',
        status: 'OPEN',
        evidence: EVIDENCE,
        ruleVersion: 'test-v1',
        notes: [
          {
            id: fixture.noteId,
            body: 'Check the pricing change.',
            authorId: user.id,
          },
        ],
        explanation: {
          status: 'COMPLETED',
          model: 'fake-model',
          content: { summary: 'Revenue fell.' },
          validationPassed: true,
          errorMessage: null,
          attempts: 1,
        },
      });
    });

    it('returns a null explanation when no explanation exists', async () => {
      const res = await request(ctx.server)
        .get(`${endpoint()}/${fixture.orderCountFindingId}`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.data.explanation).toBeNull();
      expect(res.body.data.notes).toEqual([]);
    });

    it('returns 404 for missing, cross-organization and outsider ids', async () => {
      const missing = await request(ctx.server)
        .get(`${endpoint()}/00000000-0000-4000-8000-000000000000`)
        .set(auth());
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');

      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Finding Detail Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherFixture = await seedFindings(otherOrg.body.data.id);

      const crossOrg = await request(ctx.server)
        .get(`${endpoint()}/${otherFixture.revenueFindingId}`)
        .set(auth());
      expect(crossOrg.status).toBe(404);
      expect(crossOrg.body.error.code).toBe('NOT_FOUND');

      const outsider = await registerUser(ctx.server, { email: uniqueEmail('finding-detail') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);
      const outside = await request(ctx.server)
        .get(`${endpoint()}/${fixture.revenueFindingId}`)
        .set(auth(outsiderSession.accessToken));
      expect(outside.status).toBe(404);
      expect(outside.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects an invalid finding id', async () => {
      const res = await request(ctx.server).get(`${endpoint()}/not-a-uuid`).set(auth());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
