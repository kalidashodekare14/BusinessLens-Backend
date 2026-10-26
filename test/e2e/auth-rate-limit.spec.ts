import request from 'supertest';
import {
  AUTH_THROTTLE_LIMIT,
  AUTH_THROTTLE_MESSAGE,
} from '../../src/modules/auth/auth-throttle.constants';
import { createTestApp, type TestApp } from '../helpers/test-app';

const LOGIN = '/api/v1/auth/login';
const REGISTER = '/api/v1/auth/register';

describe('auth rate limiting (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('returns 429 after the per-route limit and sets Retry-After', async () => {
    const responses = [];
    for (let attempt = 0; attempt <= AUTH_THROTTLE_LIMIT; attempt += 1) {
      responses.push(
        await request(ctx.server)
          .post(LOGIN)
          .send({ email: `missing-${attempt}@example.test`, password: 'wrong password' }),
      );
    }

    for (const res of responses.slice(0, AUTH_THROTTLE_LIMIT)) {
      expect(res.status).toBe(401);
      expect(res.headers['x-ratelimit-limit']).toBe(String(AUTH_THROTTLE_LIMIT));
    }

    const blocked = responses[AUTH_THROTTLE_LIMIT];
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: AUTH_THROTTLE_MESSAGE,
      details: [],
    });
  });

  it('keeps a separate bucket for each auth route', async () => {
    const responses = [];
    for (let attempt = 0; attempt <= AUTH_THROTTLE_LIMIT; attempt += 1) {
      responses.push(
        await request(ctx.server)
          .post(REGISTER)
          .send({ email: `invalid-${attempt}@example.test`, password: 'short' }),
      );
    }

    for (const res of responses.slice(0, AUTH_THROTTLE_LIMIT)) {
      expect(res.status).toBe(400);
    }

    const blocked = responses[AUTH_THROTTLE_LIMIT];
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
