import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { generateRefreshToken, hashRefreshToken } from '../../src/modules/auth/refresh-token.util';
import { deleteUsersByEmail } from '../helpers/db';
import {
  cookieValue,
  findSetCookie,
  loginUser,
  registerUser,
  type LoginSession,
  uniqueEmail,
} from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const ROTATED_AT_EPOCH = 'Expires=Thu, 01 Jan 1970';

describe('POST /api/v1/auth/refresh and /auth/logout (e2e)', () => {
  let ctx: TestApp;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  async function newSession(prefix: string): Promise<LoginSession> {
    const user = await registerUser(ctx.server, { email: uniqueEmail(prefix) });
    createdEmails.push(user.email);
    return loginUser(ctx.server, user);
  }

  function refresh(rawToken?: string) {
    const req = request(ctx.server).post(REFRESH);
    return rawToken ? req.set('Cookie', `bl_refresh=${rawToken}`) : req;
  }

  it('rotates the refresh token and links the old row to the replacement', async () => {
    const session = await newSession('rotate');
    const prisma = ctx.app.get(PrismaService);
    const before = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(session.rawToken) },
    });

    const res = await refresh(session.rawToken);
    expect(res.status).toBe(200);
    expect(res.body.data.expiresIn).toBe(900);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data).not.toHaveProperty('refreshToken');

    const newCookie = findSetCookie(res.headers['set-cookie'], 'bl_refresh');
    expect(newCookie).toBeDefined();
    expect(newCookie).toContain('HttpOnly');
    expect(newCookie).toContain('Path=/api/v1/auth');

    const newRawToken = cookieValue(newCookie as string);
    expect(newRawToken).not.toBe(session.rawToken);

    const oldRow = await prisma.refreshToken.findUniqueOrThrow({ where: { id: before.id } });
    const newRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(newRawToken) },
    });
    expect(oldRow.revokedAt).not.toBeNull();
    expect(oldRow.replacedById).toBe(newRow.id);
    expect(newRow.userId).toBe(before.userId);
    expect(newRow.revokedAt).toBeNull();

    const jwt = ctx.app.get(JwtService);
    const payload = await jwt.verifyAsync<Record<string, unknown>>(res.body.data.accessToken);
    expect(payload.sub).toBe(before.userId);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('treats reuse of a rotated token as theft and revokes every active token', async () => {
    const session = await newSession('reuse');
    const rotated = await refresh(session.rawToken);
    expect(rotated.status).toBe(200);

    const newCookie = findSetCookie(rotated.headers['set-cookie'], 'bl_refresh');
    const newRawToken = cookieValue(newCookie as string);

    const prisma = ctx.app.get(PrismaService);
    const stored = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(session.rawToken) },
    });

    const reused = await refresh(session.rawToken);
    expect(reused.status).toBe(401);
    expect(reused.body.error).toEqual({
      code: 'REFRESH_TOKEN_INVALID',
      message: 'Invalid or expired session.',
      details: [],
    });
    expect(findSetCookie(reused.headers['set-cookie'], 'bl_refresh')).toContain(ROTATED_AT_EPOCH);

    const activeTokens = await prisma.refreshToken.count({
      where: { userId: stored.userId, revokedAt: null },
    });
    expect(activeTokens).toBe(0);

    // The replacement issued before the replay is revoked too.
    const afterTheft = await refresh(newRawToken);
    expect(afterTheft.status).toBe(401);
  });

  it('rejects an expired token without revoking the other sessions', async () => {
    const session = await newSession('expired');
    const prisma = ctx.app.get(PrismaService);
    const loginRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(session.rawToken) },
    });

    const expiredRawToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: loginRow.userId,
        tokenHash: hashRefreshToken(expiredRawToken),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await refresh(expiredRawToken);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(findSetCookie(res.headers['set-cookie'], 'bl_refresh')).toContain(ROTATED_AT_EPOCH);

    const expiredRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(expiredRawToken) },
    });
    expect(expiredRow.revokedAt).toBeNull();

    const loginRowAfter = await prisma.refreshToken.findUniqueOrThrow({
      where: { id: loginRow.id },
    });
    expect(loginRowAfter.revokedAt).toBeNull();
  });

  it('rejects a missing or unknown refresh cookie with the same generic error', async () => {
    const missing = await refresh();
    const unknown = await refresh(generateRefreshToken());

    for (const res of [missing, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: 'REFRESH_TOKEN_INVALID',
        message: 'Invalid or expired session.',
        details: [],
      });
      expect(findSetCookie(res.headers['set-cookie'], 'bl_refresh')).toContain(ROTATED_AT_EPOCH);
    }
  });

  it('revokes the presented token on logout and clears the cookie', async () => {
    const session = await newSession('logout');
    const prisma = ctx.app.get(PrismaService);

    const res = await request(ctx.server)
      .post(LOGOUT)
      .set('Cookie', `bl_refresh=${session.rawToken}`);

    expect(res.status).toBe(204);
    expect(findSetCookie(res.headers['set-cookie'], 'bl_refresh')).toContain(ROTATED_AT_EPOCH);

    const stored = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(session.rawToken) },
    });
    expect(stored.revokedAt).not.toBeNull();

    // Idempotent, with or without a cookie.
    const again = await request(ctx.server)
      .post(LOGOUT)
      .set('Cookie', `bl_refresh=${session.rawToken}`);
    const withoutCookie = await request(ctx.server).post(LOGOUT);
    expect(again.status).toBe(204);
    expect(withoutCookie.status).toBe(204);

    const afterLogout = await refresh(session.rawToken);
    expect(afterLogout.status).toBe(401);
  });
});
