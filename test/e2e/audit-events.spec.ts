import request from 'supertest';
import { AuditAction } from '../../src/modules/audit/audit.actions';
import { AuditService } from '../../src/modules/audit/audit.service';
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

class RollbackProbe extends Error {}

describe('audit events (e2e)', () => {
  let ctx: TestApp;
  let recordSpy: jest.SpyInstance;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(() => {
    recordSpy = jest.spyOn(ctx.app.get(AuditService), 'record');
  });

  afterEach(() => {
    recordSpy.mockRestore();
  });

  afterAll(async () => {
    // Let the fire-and-forget writes finish before tearing the app down.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await deleteUsersByEmail(ctx.app, createdEmails);
    await deleteOrganizationsById(ctx.app, createdOrganizationIds);
    await ctx.close();
  });

  async function registerAndLogin(prefix: string): Promise<{
    user: RegisteredUser;
    session: LoginSession;
  }> {
    const user = await registerUser(ctx.server, { email: uniqueEmail(prefix) });
    createdEmails.push(user.email);
    const session = await loginUser(ctx.server, user);
    return { user, session };
  }

  function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  it('lets the app role insert audit rows', async () => {
    const prisma = ctx.app.get(PrismaService);

    await expect(
      prisma.$transaction(async (tx) => {
        const result = await tx.auditLog.createMany({
          data: [{ action: 'test.insert_probe', actorId: null }],
        });
        expect(result.count).toBe(1);
        throw new RollbackProbe();
      }),
    ).rejects.toBeInstanceOf(RollbackProbe);
  });

  it('records register, login success and both failure shapes', async () => {
    const { user } = await registerAndLogin('audit-auth');

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.AUTH_REGISTER,
        actorId: user.id,
        entityType: 'User',
        entityId: user.id,
      }),
    );
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.AUTH_LOGIN,
        actorId: user.id,
        entityType: 'User',
        entityId: user.id,
      }),
    );

    const wrongPassword = await request(ctx.server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong password' });
    expect(wrongPassword.status).toBe(401);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AUTH_LOGIN_FAILED, actorId: user.id }),
    );

    const unknownEmail = await request(ctx.server)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: 'wrong password' });
    expect(unknownEmail.status).toBe(401);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AUTH_LOGIN_FAILED, actorId: null }),
    );
  });

  it('records logout', async () => {
    const { user, session } = await registerAndLogin('audit-logout');

    const res = await request(ctx.server)
      .post('/api/v1/auth/logout')
      .set('Cookie', `bl_refresh=${session.rawToken}`);

    expect(res.status).toBe(204);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AUTH_LOGOUT, actorId: user.id }),
    );
  });

  it('records password changes', async () => {
    const { user, session } = await registerAndLogin('audit-password');

    const res = await request(ctx.server)
      .post('/api/v1/users/me/change-password')
      .set(auth(session.accessToken))
      .send({ currentPassword: user.password, newPassword: 'a replacement password' });

    expect(res.status).toBe(204);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.USER_PASSWORD_CHANGED,
        actorId: user.id,
        entityType: 'User',
        entityId: user.id,
      }),
    );
  });

  it('records organization create and update with the organization id', async () => {
    const { user, session } = await registerAndLogin('audit-org');

    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth(session.accessToken))
      .send({ name: 'Audit Co' });
    expect(created.status).toBe(201);
    const organizationId = created.body.data.id as string;
    createdOrganizationIds.push(organizationId);

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ORGANIZATION_CREATED,
        actorId: user.id,
        organizationId,
        entityType: 'Organization',
        entityId: organizationId,
      }),
    );

    const updated = await request(ctx.server)
      .patch(`/api/v1/organizations/${organizationId}`)
      .set(auth(session.accessToken))
      .send({ name: 'Audit Co International' });
    expect(updated.status).toBe(200);

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ORGANIZATION_UPDATED,
        actorId: user.id,
        organizationId,
        entityType: 'Organization',
        entityId: organizationId,
      }),
    );
  });
});
