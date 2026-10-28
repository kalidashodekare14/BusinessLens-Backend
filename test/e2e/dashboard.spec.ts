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

const SNAPSHOT = {
  version: 1,
  referenceDate: '2026-09-30T00:00:00.000Z',
  current: {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-30T00:00:00.000Z',
    revenue: '80.00',
    orderCount: 10,
    averageOrderValue: '8.00',
    products: [],
  },
  previous: {
    start: '2026-08-02T00:00:00.000Z',
    end: '2026-08-31T00:00:00.000Z',
    revenue: '100.00',
    orderCount: 20,
    averageOrderValue: '5.00',
    products: [],
  },
};

describe('dashboard (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('dashboard') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Dashboard Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);
  });

  afterAll(async () => {
    const tenant = ctx.app.get(TenantPrismaService);
    for (const id of createdOrganizationIds) {
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
    return `/api/v1/organizations/${orgId}/dashboard`;
  }

  async function seedDashboard(orgId = organizationId): Promise<void> {
    await ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const run = await tx.analysisRun.create({
        data: {
          organizationId: orgId,
          triggeredById: user.id,
          status: 'COMPLETED',
          referenceDate: new Date('2026-09-30T00:00:00.000Z'),
          metricsSnapshot: SNAPSHOT as unknown as Prisma.InputJsonValue,
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        select: { id: true },
      });

      const finding = (
        severity: 'MEDIUM' | 'HIGH',
        status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED',
      ) =>
        tx.finding.create({
          data: {
            organizationId: orgId,
            analysisRunId: run.id,
            type: 'REVENUE_DROP',
            severity,
            status,
            title: 'Revenue dropped 20.0%',
            evidence: { metric: 'revenue' } as unknown as Prisma.InputJsonValue,
            ruleVersion: 'test-v1',
            ...(status === 'RESOLVED' ? { resolvedAt: new Date('2026-10-02T00:00:00.000Z') } : {}),
          },
        });

      await finding('HIGH', 'OPEN');
      await finding('HIGH', 'INVESTIGATING');
      await finding('MEDIUM', 'OPEN');
      await finding('MEDIUM', 'RESOLVED');
    });
  }

  it('returns zeros and nulls for an organization without data', async () => {
    const res = await request(ctx.server).get(endpoint()).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      openFindings: { total: 0, bySeverity: { MEDIUM: 0, HIGH: 0 } },
      latestAnalysisRun: null,
      metrics: null,
    });
  });

  it('returns open finding counts, the latest run and its metrics', async () => {
    await seedDashboard();

    const res = await request(ctx.server).get(endpoint()).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.openFindings).toEqual({
      total: 3,
      bySeverity: { HIGH: 2, MEDIUM: 1 },
    });
    expect(res.body.data.latestAnalysisRun).toMatchObject({
      status: 'COMPLETED',
      referenceDate: '2026-09-30T00:00:00.000Z',
    });
    expect(res.body.data.metrics).toEqual({
      referenceDate: '2026-09-30T00:00:00.000Z',
      revenue: { current: '80.00', previous: '100.00', changePercent: -20 },
      orderCount: { current: 10, previous: 20, changePercent: -50 },
      averageOrderValue: { current: '8.00', previous: '5.00', changePercent: 60 },
    });
  });

  it('shows only the caller organization’s data', async () => {
    await seedDashboard();

    const otherOrg = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Other Dashboard Co' });
    expect(otherOrg.status).toBe(201);
    createdOrganizationIds.push(otherOrg.body.data.id);

    const other = await request(ctx.server).get(endpoint(otherOrg.body.data.id)).set(auth());
    expect(other.status).toBe(200);
    expect(other.body.data).toEqual({
      openFindings: { total: 0, bySeverity: { MEDIUM: 0, HIGH: 0 } },
      latestAnalysisRun: null,
      metrics: null,
    });
  });

  it('requires membership of the organization', async () => {
    const outsider = await registerUser(ctx.server, { email: uniqueEmail('dashboard-outsider') });
    createdEmails.push(outsider.email);
    const outsiderSession = await loginUser(ctx.server, outsider);

    const res = await request(ctx.server).get(endpoint()).set(auth(outsiderSession.accessToken));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
