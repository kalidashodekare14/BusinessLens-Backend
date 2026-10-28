import request from 'supertest';
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
  'Order ID,Order Date,Status,Product,SKU,Qty,Unit Price\n1001,2026-01-01,completed,Widget,SKU-1,1,9.99\n';

/** Audit writes are fire-and-forget (§6.5); give them a moment to commit. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

describe('GET /audit-logs (e2e)', () => {
  let ctx: TestApp;
  let owner: RegisteredUser;
  let ownerSession: LoginSession;
  let outsider: LoginSession;
  let organizationId: string;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx.server, { email: uniqueEmail('audit-owner') });
    const outsiderUser = await registerUser(ctx.server, { email: uniqueEmail('audit-outsider') });
    createdEmails.push(owner.email, outsiderUser.email);
    ownerSession = await loginUser(ctx.server, owner);
    outsider = await loginUser(ctx.server, outsiderUser);
  });

  afterAll(async () => {
    await deleteOrganizationsById(ctx.app, createdOrganizationIds);
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  function auth(token = ownerSession.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  function endpoint(orgId = organizationId): string {
    return `/api/v1/organizations/${orgId}/audit-logs`;
  }

  async function createOrg(name: string): Promise<string> {
    const res = await request(ctx.server).post('/api/v1/organizations').set(auth()).send({ name });
    expect(res.status).toBe(201);
    createdOrganizationIds.push(res.body.data.id);
    return res.body.data.id;
  }

  /** organization.created + organization.updated + import.uploaded. */
  async function generateOrgEvents(orgId: string): Promise<void> {
    const updated = await request(ctx.server)
      .patch(`/api/v1/organizations/${orgId}`)
      .set(auth())
      .send({ name: 'Audited Org Renamed' });
    expect(updated.status).toBe(200);

    const uploaded = await request(ctx.server)
      .post(`/api/v1/organizations/${orgId}/imports`)
      .set(auth())
      .field('type', 'ORDERS')
      .attach('file', Buffer.from(ORDERS_CSV), 'orders.csv');
    expect(uploaded.status).toBe(201);
  }

  function actionsOf(body: { data: Array<{ action: string }> }): string[] {
    return body.data.map((row) => row.action);
  }

  it('rejects requests without a token', async () => {
    organizationId = await createOrg('Audit Fresh');
    const res = await request(ctx.server).get(endpoint());
    expect(res.status).toBe(401);
  });

  it('returns 404 to an outsider', async () => {
    const res = await request(ctx.server).get(endpoint()).set(auth(outsider.accessToken));
    expect(res.status).toBe(404);
  });

  it('rejects a MEMBER with 403', async () => {
    organizationId = await createOrg('Audit Member Co');
    const member = await registerUser(ctx.server, { email: uniqueEmail('audit-member') });
    createdEmails.push(member.email);
    const memberSession = await loginUser(ctx.server, member);
    await ctx.app.get(PrismaService).membership.create({
      data: { userId: member.id, organizationId, role: 'MEMBER' },
    });

    const res = await request(ctx.server).get(endpoint()).set(auth(memberSession.accessToken));
    expect(res.status).toBe(403);
  });

  it('lists the organization audit trail newest first with pagination meta', async () => {
    organizationId = await createOrg('Audit List Co');
    await generateOrgEvents(organizationId);
    // A fresh login writes auth.login with a null organization; it must never
    // show up in a tenant audit response (§6.3).
    await loginUser(ctx.server, owner);
    await settle();

    const res = await request(ctx.server).get(endpoint()).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: res.body.data.length });

    const actions = actionsOf(res.body);
    expect(actions).toEqual(
      expect.arrayContaining(['organization.created', 'organization.updated', 'import.uploaded']),
    );
    expect(actions).not.toEqual(expect.arrayContaining([expect.stringMatching(/^auth\./)]));

    const dates = res.body.data.map((row: { createdAt: string }) => Date.parse(row.createdAt));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);

    for (const row of res.body.data) {
      expect(row).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          action: expect.any(String),
          actorId: owner.id,
          entityType: expect.any(String),
          entityId: expect.any(String),
          createdAt: expect.any(String),
        }),
      );
      // No secrets ever travel through the audit trail.
      expect(JSON.stringify(row)).not.toMatch(/password|token|secret/i);
    }
  });

  it('paginates with page and pageSize and rejects invalid paging', async () => {
    organizationId = await createOrg('Audit Paging Co');
    await generateOrgEvents(organizationId);
    await settle();

    const first = await request(ctx.server).get(`${endpoint()}?page=1&pageSize=2`).set(auth());
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });

    const second = await request(ctx.server).get(`${endpoint()}?page=2&pageSize=2`).set(auth());
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });

    const seen = new Set(
      [...first.body.data, ...second.body.data].map((row: { id: string }) => row.id),
    );
    expect(seen.size).toBe(3);

    for (const query of ['page=0', 'pageSize=0', 'pageSize=101', 'page=abc']) {
      const invalid = await request(ctx.server).get(`${endpoint()}?${query}`).set(auth());
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('never shows another organization’s audit rows', async () => {
    organizationId = await createOrg('Audit Isolation A');
    await generateOrgEvents(organizationId);
    await settle();

    const otherOrgId = await createOrg('Audit Isolation B');
    const otherRes = await request(ctx.server)
      .post(`/api/v1/organizations/${otherOrgId}/imports`)
      .set(auth())
      .field('type', 'ORDERS')
      .attach('file', Buffer.from(ORDERS_CSV), 'orders.csv');
    expect(otherRes.status).toBe(201);
    await settle();

    const mine = await request(ctx.server).get(`${endpoint()}?pageSize=100`).set(auth());
    const theirs = await request(ctx.server).get(endpoint(otherOrgId)).set(auth());

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    expect(theirs.body.meta.total).toBe(2); // organization.created + import.uploaded
    const myIds = new Set(mine.body.data.map((row: { id: string }) => row.id));
    for (const row of theirs.body.data) {
      expect(myIds.has(row.id)).toBe(false);
    }
    const theirImportRow = theirs.body.data.find(
      (row: { action: string }) => row.action === 'import.uploaded',
    );
    expect(theirImportRow).toBeDefined();

    // And the isolation holds at the database level too: org A's rows are all
    // scoped to org A (RLS would hide anything else anyway).
    const scoped = await ctx.app
      .get(TenantPrismaService)
      .run(organizationId, (tx) => tx.auditLog.count({ where: { organizationId } }));
    expect(scoped).toBe(mine.body.meta.total);
  });
});
