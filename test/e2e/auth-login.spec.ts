import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { hashRefreshToken } from '../../src/modules/auth/refresh-token.util';
import { deleteUsersByEmail } from '../helpers/db';
import {
  cookieValue,
  findSetCookie,
  registerUser,
  type RegisteredUser,
  TEST_PASSWORD,
  uniqueEmail,
} from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const LOGIN = '/api/v1/auth/login';

describe('POST /api/v1/auth/login (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('login') });
    createdEmails.push(user.email);
  });

  afterAll(async () => {
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  it('returns a 15-minute access token and sets a hardened refresh cookie', async () => {
    const res = await request(ctx.server)
      .post(LOGIN)
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.data.expiresIn).toBe(900);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(res.body)).not.toContain('bl_refresh');

    const setCookie = findSetCookie(res.headers['set-cookie'], 'bl_refresh');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/v1/auth');
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain('Max-Age=604800');
    if (process.env.COOKIE_SECURE === 'true') {
      expect(setCookie).toContain('Secure');
    } else {
      expect(setCookie).not.toContain('Secure');
    }

    const jwt = ctx.app.get(JwtService);
    const payload = await jwt.verifyAsync<Record<string, unknown>>(res.body.data.accessToken);
    expect(payload.sub).toBe(user.id);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);

    const rawToken = cookieValue(setCookie as string);
    const prisma = ctx.app.get(PrismaService);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });

    expect(stored?.userId).toBe(user.id);
    expect(stored?.revokedAt).toBeNull();
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toBe(rawToken);
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });

  it('accepts a case-insensitive email', async () => {
    const res = await request(ctx.server)
      .post(LOGIN)
      .send({ email: user.email.toUpperCase(), password: user.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
  });

  it('returns the same generic 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(ctx.server)
      .post(LOGIN)
      .send({ email: user.email, password: 'wrong password' });

    const unknownEmail = await request(ctx.server)
      .post(LOGIN)
      .send({ email: uniqueEmail('missing'), password: TEST_PASSWORD });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
        details: [],
      });
      expect(findSetCookie(res.headers['set-cookie'], 'bl_refresh')).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(TEST_PASSWORD);
    }
  });

  it('does not create a refresh token for a failed login', async () => {
    const prisma = ctx.app.get(PrismaService);
    const before = await prisma.refreshToken.count({ where: { userId: user.id } });

    await request(ctx.server).post(LOGIN).send({ email: user.email, password: 'wrong password' });

    const after = await prisma.refreshToken.count({ where: { userId: user.id } });
    expect(after).toBe(before);
  });
});
