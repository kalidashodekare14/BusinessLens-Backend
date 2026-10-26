import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { deleteOrganizationsById, deleteUsersByEmail } from '../helpers/db';
import {
  loginUser,
  registerUser,
  type LoginSession,
  type RegisteredUser,
  uniqueEmail,
} from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const ORGANIZATIONS = '/api/v1/organizations';

describe('organizations (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByEmail(ctx.app, createdEmails);
    await deleteOrganizationsById(ctx.app, createdOrganizationIds);
    await ctx.close();
  });

  beforeEach(async () => {
    user = await registerUser(ctx.server, { email: uniqueEmail('org') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  function auth(token = session.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  async function createOrganization(
    token: string,
    name: string,
  ): Promise<{
    id: string;
    name: string;
    currency: string;
    timezone: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  }> {
    const res = await request(ctx.server).post(ORGANIZATIONS).set(auth(token)).send({ name });

    expect(res.status).toBe(201);
    createdOrganizationIds.push(res.body.data.id);
    return res.body.data;
  }

  async function createOtherUser(): Promise<{ user: RegisteredUser; session: LoginSession }> {
    const otherUser = await registerUser(ctx.server, { email: uniqueEmail('other-org') });
    createdEmails.push(otherUser.email);
    const otherSession = await loginUser(ctx.server, otherUser);

    return { user: otherUser, session: otherSession };
  }

  it('requires authentication for every organization route', async () => {
    const list = await request(ctx.server).get(ORGANIZATIONS);
    const create = await request(ctx.server).post(ORGANIZATIONS).send({ name: 'Acme' });
    const detail = await request(ctx.server).get(`${ORGANIZATIONS}/${randomUUID()}`);

    for (const res of [list, create, detail]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('creates the organization and its OWNER membership together', async () => {
    const created = await createOrganization(session.accessToken, '  Acme  ');

    expect(created).toMatchObject({
      name: 'Acme',
      currency: 'USD',
      timezone: 'UTC',
      role: 'OWNER',
    });
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);

    const membership = await ctx.app.get(PrismaService).membership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId: created.id },
      },
      select: { role: true, organizationId: true },
    });

    expect(membership).toEqual({ role: 'OWNER', organizationId: created.id });
  });

  it('rejects blank names and unknown body properties', async () => {
    const blank = await request(ctx.server).post(ORGANIZATIONS).set(auth()).send({ name: '   ' });

    expect(blank.status).toBe(400);
    expect(blank.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
    );

    const extra = await request(ctx.server)
      .post(ORGANIZATIONS)
      .set(auth())
      .send({ name: 'Acme', ownerId: 'somebody-else' });

    expect(extra.status).toBe(400);
    expect(extra.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'ownerId' })]),
    );
  });

  it('lists only the caller organizations with pagination meta', async () => {
    await createOrganization(session.accessToken, 'Alpha');
    await createOrganization(session.accessToken, 'Beta');
    await createOrganization(session.accessToken, 'Gamma');

    const other = await createOtherUser();
    await createOrganization(other.session.accessToken, 'Other Co');

    const firstPage = await request(ctx.server).get(ORGANIZATIONS).set(auth());
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.meta).toEqual({ page: 1, pageSize: 20, total: 3 });
    expect(firstPage.body.data.map((org: { name: string }) => org.name).sort()).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);

    const sized = await request(ctx.server)
      .get(ORGANIZATIONS)
      .query({ page: 1, pageSize: 2 })
      .set(auth());
    expect(sized.status).toBe(200);
    expect(sized.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(sized.body.data).toHaveLength(2);

    const secondPage = await request(ctx.server)
      .get(ORGANIZATIONS)
      .query({ page: 2, pageSize: 2 })
      .set(auth());
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
    expect(secondPage.body.data).toHaveLength(1);

    const otherList = await request(ctx.server)
      .get(ORGANIZATIONS)
      .set(auth(other.session.accessToken));
    expect(otherList.status).toBe(200);
    expect(otherList.body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    expect(otherList.body.data).toEqual([
      expect.objectContaining({ name: 'Other Co', role: 'OWNER' }),
    ]);

    const tooBig = await request(ctx.server)
      .get(ORGANIZATIONS)
      .query({ pageSize: 101 })
      .set(auth());
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'pageSize' })]),
    );
  });

  it('returns an organization to members only and hides ids from outsiders', async () => {
    const created = await createOrganization(session.accessToken, 'Acme');

    const own = await request(ctx.server).get(`${ORGANIZATIONS}/${created.id}`).set(auth());
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({
      id: created.id,
      name: 'Acme',
      currency: 'USD',
      timezone: 'UTC',
      role: 'OWNER',
    });

    const other = await createOtherUser();
    const outsider = await request(ctx.server)
      .get(`${ORGANIZATIONS}/${created.id}`)
      .set(auth(other.session.accessToken));
    expect(outsider.status).toBe(404);
    expect(outsider.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Organization not found.',
    });

    await ctx.app.get(PrismaService).membership.create({
      data: { userId: other.user.id, organizationId: created.id, role: 'MEMBER' },
    });

    const member = await request(ctx.server)
      .get(`${ORGANIZATIONS}/${created.id}`)
      .set(auth(other.session.accessToken));
    expect(member.status).toBe(200);
    expect(member.body.data.role).toBe('MEMBER');

    const missing = await request(ctx.server).get(`${ORGANIZATIONS}/${randomUUID()}`).set(auth());
    expect(missing.status).toBe(404);

    const malformed = await request(ctx.server).get(`${ORGANIZATIONS}/not-a-uuid`).set(auth());
    expect(malformed.status).toBe(400);
  });
});
