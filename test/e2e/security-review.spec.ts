import request from 'supertest';
import { createTestApp, type TestApp } from '../helpers/test-app';

/**
 * T6.3 security review: CORS must only allow the configured frontend origin
 * (§6.4). Cookie flags, upload limits, error leakage and the app_user role are
 * covered by auth-login, imports-upload, all-exceptions.filter and rls specs.
 */
describe('security review: CORS (T6.3)', () => {
  let ctx: TestApp;
  const allowedOrigin = (process.env.CORS_ORIGIN ?? '').split(',')[0].trim();

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('allows the configured origin with credentials', async () => {
    const res = await request(ctx.server).get('/api/v1/health').set('Origin', allowedOrigin);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers a preflight for the configured origin only', async () => {
    const allowed = await request(ctx.server)
      .options('/api/v1/auth/login')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'POST');

    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const rejected = await request(ctx.server)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never echoes an unknown origin on a real request', async () => {
    const res = await request(ctx.server)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
