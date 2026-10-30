import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { deleteUsersByEmail } from '../helpers/db';
import { TEST_PASSWORD, uniqueEmail } from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const REGISTER = '/api/v1/auth/register';

describe('POST /api/v1/auth/register (e2e)', () => {
  let ctx: TestApp;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  function track(email: string): string {
    const normalized = email.trim().toLowerCase();
    createdEmails.push(normalized);
    return normalized;
  }

  it('creates a user, normalizes the email and never returns the hash', async () => {
    const normalized = track(`  ${uniqueEmail('Register').toUpperCase()}  `);
    const rawEmail = `  ${normalized.toUpperCase()}  `;

    const res = await request(ctx.server)
      .post(REGISTER)
      .send({ email: rawEmail, password: TEST_PASSWORD, name: '  Ada Lovelace  ' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: normalized, name: 'Ada Lovelace' });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(res.body.data.createdAt))).toBe(false);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.expiresIn).toBe(900);
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(TEST_PASSWORD);

    const prisma = ctx.app.get(PrismaService);
    const stored = await prisma.user.findUnique({ where: { email: normalized } });
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('rejects a duplicate email with a generic 409', async () => {
    const email = track(uniqueEmail('duplicate'));

    const first = await request(ctx.server)
      .post(REGISTER)
      .send({ email, password: TEST_PASSWORD, name: 'First' });
    expect(first.status).toBe(201);

    const duplicate = await request(ctx.server)
      .post(REGISTER)
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD, name: 'Second' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
    expect(duplicate.body.error.message).toBe(
      'An account with these details could not be created.',
    );
    expect(duplicate.body.error.details).toEqual([]);
    expect(JSON.stringify(duplicate.body)).not.toContain(email);
  });

  it('rejects a password shorter than 10 characters', async () => {
    const email = track(uniqueEmail('weak-password'));

    const res = await request(ctx.server)
      .post(REGISTER)
      .send({ email, password: 'short', name: 'Weak' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    );
  });

  it('rejects unknown body properties', async () => {
    const email = track(uniqueEmail('unknown-prop'));

    const res = await request(ctx.server)
      .post(REGISTER)
      .send({ email, password: TEST_PASSWORD, name: 'Prop', organizationId: 'not-trusted' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'organizationId' })]),
    );
  });

  it('rejects a blank name after trimming', async () => {
    const email = track(uniqueEmail('blank-name'));

    const res = await request(ctx.server)
      .post(REGISTER)
      .send({ email, password: TEST_PASSWORD, name: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
    );
  });
});
