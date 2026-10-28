import request from 'supertest';
import { Prisma } from '../../src/generated/prisma/client';
import { AuditAction } from '../../src/modules/audit/audit.actions';
import { AuditService } from '../../src/modules/audit/audit.service';
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

  describe('PATCH /findings/:findingId/status', () => {
    function statusEndpoint(findingId: string): string {
      return `${endpoint()}/${findingId}/status`;
    }

    it('walks the workflow and manages resolvedAt', async () => {
      const started = await request(ctx.server)
        .patch(statusEndpoint(fixture.revenueFindingId))
        .set(auth())
        .send({ status: 'INVESTIGATING' });
      expect(started.status).toBe(200);
      expect(started.body.data).toMatchObject({
        id: fixture.revenueFindingId,
        status: 'INVESTIGATING',
        resolvedAt: null,
      });

      const resolved = await request(ctx.server)
        .patch(statusEndpoint(fixture.revenueFindingId))
        .set(auth())
        .send({ status: 'RESOLVED' });
      expect(resolved.status).toBe(200);
      expect(resolved.body.data.status).toBe('RESOLVED');
      expect(resolved.body.data.resolvedAt).not.toBeNull();

      const reopened = await request(ctx.server)
        .patch(statusEndpoint(fixture.revenueFindingId))
        .set(auth())
        .send({ status: 'OPEN' });
      expect(reopened.status).toBe(200);
      expect(reopened.body.data).toMatchObject({ status: 'OPEN', resolvedAt: null });

      const detail = await request(ctx.server)
        .get(`${endpoint()}/${fixture.revenueFindingId}`)
        .set(auth());
      expect(detail.body.data).toMatchObject({ status: 'OPEN', resolvedAt: null });
    });

    it('rejects skipped, reversed and no-op transitions with 409', async () => {
      const cases: Array<{ findingId: string; status: string }> = [
        // OPEN cannot skip INVESTIGATING.
        { findingId: fixture.revenueFindingId, status: 'RESOLVED' },
        // No-op to the current status.
        { findingId: fixture.revenueFindingId, status: 'OPEN' },
        // INVESTIGATING cannot go straight back to OPEN.
        { findingId: fixture.orderCountFindingId, status: 'OPEN' },
        // RESOLVED can only reopen, not move backwards to INVESTIGATING.
        { findingId: fixture.productFindingId, status: 'INVESTIGATING' },
      ];

      for (const testCase of cases) {
        const res = await request(ctx.server)
          .patch(statusEndpoint(testCase.findingId))
          .set(auth())
          .send({ status: testCase.status });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_TRANSITION');
      }
    });

    it('rejects invalid status bodies with 400', async () => {
      for (const body of [
        {},
        { status: 'BOGUS' },
        { status: 'open' },
        { status: 'OPEN', extra: true },
      ]) {
        const res = await request(ctx.server)
          .patch(statusEndpoint(fixture.revenueFindingId))
          .set(auth())
          .send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('returns 404 for missing, cross-organization and outsider ids', async () => {
      const missing = await request(ctx.server)
        .patch(statusEndpoint('00000000-0000-4000-8000-000000000000'))
        .set(auth())
        .send({ status: 'INVESTIGATING' });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');

      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Status Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherFixture = await seedFindings(otherOrg.body.data.id);

      const crossOrg = await request(ctx.server)
        .patch(statusEndpoint(otherFixture.revenueFindingId))
        .set(auth())
        .send({ status: 'INVESTIGATING' });
      expect(crossOrg.status).toBe(404);

      const outsider = await registerUser(ctx.server, { email: uniqueEmail('findings-status') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);
      const outside = await request(ctx.server)
        .patch(statusEndpoint(fixture.revenueFindingId))
        .set(auth(outsiderSession.accessToken))
        .send({ status: 'INVESTIGATING' });
      expect(outside.status).toBe(404);
    });

    it('records a status change audit event', async () => {
      const recordSpy = jest.spyOn(ctx.app.get(AuditService), 'record');
      try {
        const res = await request(ctx.server)
          .patch(statusEndpoint(fixture.revenueFindingId))
          .set(auth())
          .send({ status: 'INVESTIGATING' });
        expect(res.status).toBe(200);

        expect(recordSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.FINDING_STATUS_CHANGED,
            actorId: user.id,
            organizationId,
            entityType: 'Finding',
            entityId: fixture.revenueFindingId,
            metadata: { from: 'OPEN', to: 'INVESTIGATING' },
          }),
        );
      } finally {
        recordSpy.mockRestore();
      }
    });
  });

  describe('finding notes', () => {
    function notesEndpoint(findingId: string, noteId?: string): string {
      const base = `${endpoint()}/${findingId}/notes`;
      return noteId ? `${base}/${noteId}` : base;
    }

    it('creates a note and shows it in the detail view', async () => {
      const res = await request(ctx.server)
        .post(notesEndpoint(fixture.revenueFindingId))
        .set(auth())
        .send({ body: '  Check the pricing change too.  ' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        body: 'Check the pricing change too.',
        authorId: user.id,
      });
      expect(res.body.data.id).toBeDefined();

      const detail = await request(ctx.server)
        .get(`${endpoint()}/${fixture.revenueFindingId}`)
        .set(auth());
      expect(detail.body.data.notes).toHaveLength(2);
      expect(detail.body.data.notes[1]).toMatchObject({
        id: res.body.data.id,
        body: 'Check the pricing change too.',
      });
    });

    it('rejects empty, oversized and unknown body properties', async () => {
      for (const body of [
        {},
        { body: '   ' },
        { body: 123 },
        { body: 'x'.repeat(2001) },
        { body: 'looks fine', authorId: user.id },
      ]) {
        const res = await request(ctx.server)
          .post(notesEndpoint(fixture.revenueFindingId))
          .set(auth())
          .send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('lets only the author delete their note', async () => {
      const other = await registerUser(ctx.server, { email: uniqueEmail('findings-note-author') });
      createdEmails.push(other.email);
      const otherSession = await loginUser(ctx.server, other);
      await ctx.app.get(PrismaService).membership.create({
        data: { userId: other.id, organizationId, role: 'MEMBER' },
      });

      const created = await request(ctx.server)
        .post(notesEndpoint(fixture.revenueFindingId))
        .set(auth(otherSession.accessToken))
        .send({ body: 'From the second member.' });
      expect(created.status).toBe(201);
      const noteId = created.body.data.id as string;

      // A different member of the same organization cannot delete it.
      const denied = await request(ctx.server)
        .delete(notesEndpoint(fixture.revenueFindingId, noteId))
        .set(auth());
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('NOT_FOUND');

      const stillThere = await request(ctx.server)
        .get(`${endpoint()}/${fixture.revenueFindingId}`)
        .set(auth());
      expect(stillThere.body.data.notes).toHaveLength(2);

      // The author can.
      const deleted = await request(ctx.server)
        .delete(notesEndpoint(fixture.revenueFindingId, noteId))
        .set(auth(otherSession.accessToken));
      expect(deleted.status).toBe(204);
      expect(deleted.body).toEqual({});

      const after = await request(ctx.server)
        .get(`${endpoint()}/${fixture.revenueFindingId}`)
        .set(auth());
      expect(after.body.data.notes).toHaveLength(1);
      expect(after.body.data.notes[0].id).toBe(fixture.noteId);
    });

    it('returns 404 for missing notes, other findings and missing findings', async () => {
      const missingNote = await request(ctx.server)
        .delete(notesEndpoint(fixture.revenueFindingId, '00000000-0000-4000-8000-000000000000'))
        .set(auth());
      expect(missingNote.status).toBe(404);

      // The revenue note does not belong to the order-count finding.
      const wrongFinding = await request(ctx.server)
        .delete(notesEndpoint(fixture.orderCountFindingId, fixture.noteId))
        .set(auth());
      expect(wrongFinding.status).toBe(404);

      const stillOwned = await request(ctx.server)
        .get(`${endpoint()}/${fixture.revenueFindingId}`)
        .set(auth());
      expect(stillOwned.body.data.notes).toHaveLength(1);

      const missingFinding = await request(ctx.server)
        .post(notesEndpoint('00000000-0000-4000-8000-000000000000'))
        .set(auth())
        .send({ body: 'orphan note' });
      expect(missingFinding.status).toBe(404);
    });

    it('returns 404 for notes on another organization’s finding', async () => {
      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Notes Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherFixture = await seedFindings(otherOrg.body.data.id);

      const create = await request(ctx.server)
        .post(notesEndpoint(otherFixture.revenueFindingId))
        .set(auth())
        .send({ body: 'should not be allowed' });
      expect(create.status).toBe(404);

      const remove = await request(ctx.server)
        .delete(notesEndpoint(otherFixture.revenueFindingId, otherFixture.noteId))
        .set(auth());
      expect(remove.status).toBe(404);
    });
  });
});
