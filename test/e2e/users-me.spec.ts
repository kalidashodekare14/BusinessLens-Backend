import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { deleteOrganizationsById, deleteUsersByEmail } from '../helpers/db';
import {
  findSetCookie,
  loginUser,
  registerUser,
  type LoginSession,
  type RegisteredUser,
  uniqueEmail,
} from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const ME = '/api/v1/users/me';
const CHANGE_PASSWORD = '/api/v1/users/me/change-password';
const ROTATED_AT_EPOCH = 'Expires=Thu, 01 Jan 1970';

describe('users self-service (e2e)', () => {
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
    user = await registerUser(ctx.server, { email: uniqueEmail('me') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  function auth(token = session.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  it('rejects requests without a valid bearer token', async () => {
    const missing = await request(ctx.server).get(ME);
    const invalid = await request(ctx.server).get(ME).set('Authorization', 'Bearer not-a-jwt');
    const wrongScheme = await request(ctx.server)
      .get(ME)
      .set('Authorization', `Basic ${session.accessToken}`);

    for (const res of [missing, invalid, wrongScheme]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }
  });

  it('returns the caller profile without secrets or password data', async () => {
    const res = await request(ctx.server).get(ME).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, email: user.email, name: user.name });
    expect(res.body.data.organizations).toEqual([]);
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(user.password);
    expect(Number.isNaN(Date.parse(res.body.data.createdAt))).toBe(false);
  });

  it('includes the caller memberships and their roles', async () => {
    const prisma = ctx.app.get(PrismaService);
    const organization = await prisma.organization.create({ data: { name: 'Acme' } });
    createdOrganizationIds.push(organization.id);
    await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
    });

    const res = await request(ctx.server).get(ME).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.organizations).toEqual([
      { id: organization.id, name: 'Acme', currency: 'USD', timezone: 'UTC', role: 'OWNER' },
    ]);
  });

  it('updates the caller name and rejects unknown body properties', async () => {
    const ok = await request(ctx.server).patch(ME).set(auth()).send({ name: '  Grace Hopper  ' });

    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ id: user.id, name: 'Grace Hopper' });
    expect(ok.body.data).not.toHaveProperty('passwordHash');

    const stored = await ctx.app
      .get(PrismaService)
      .user.findUnique({ where: { id: user.id }, select: { name: true } });
    expect(stored?.name).toBe('Grace Hopper');

    const extra = await request(ctx.server)
      .patch(ME)
      .set(auth())
      .send({ name: 'X', userId: 'another-user' });

    expect(extra.status).toBe(400);
    expect(extra.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'userId' })]),
    );
  });

  it('rejects a wrong current password and a weak new password', async () => {
    const wrongCurrent = await request(ctx.server)
      .post(CHANGE_PASSWORD)
      .set(auth())
      .send({ currentPassword: 'wrong password', newPassword: 'a brand new password' });

    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.error.code).toBe('INVALID_CURRENT_PASSWORD');

    const weakNew = await request(ctx.server)
      .post(CHANGE_PASSWORD)
      .set(auth())
      .send({ currentPassword: user.password, newPassword: 'short' });

    expect(weakNew.status).toBe(400);
    expect(weakNew.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'newPassword' })]),
    );
  });

  it('changes the password, revokes every session and clears the cookie', async () => {
    const secondSession = await loginUser(ctx.server, user);
    const prisma = ctx.app.get(PrismaService);

    const activeBefore = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeBefore).toBe(3);

    const newPassword = 'an even better password 42';
    const res = await request(ctx.server)
      .post(CHANGE_PASSWORD)
      .set(auth())
      .send({ currentPassword: user.password, newPassword });

    expect(res.status).toBe(204);
    expect(findSetCookie(res.headers['set-cookie'], 'bl_refresh')).toContain(ROTATED_AT_EPOCH);

    const activeAfter = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeAfter).toBe(0);

    const oldLogin = await request(ctx.server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(ctx.server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword });
    expect(newLogin.status).toBe(200);

    const refreshWithOldSession = await request(ctx.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `bl_refresh=${secondSession.rawToken}`);
    expect(refreshWithOldSession.status).toBe(401);
  });
});
