import { randomUUID } from 'node:crypto';
import request from 'supertest';

/** Unique per test run so parallel suites never collide on the unique email. */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/** Meets the 10-character minimum; used verbatim in tests. */
export const TEST_PASSWORD = 'correct horse battery staple';

export type SuperTestTarget = Parameters<typeof request>[0];

export interface RegisteredUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

/** Registers over the real HTTP pipeline and returns the persisted identity. */
export async function registerUser(
  server: SuperTestTarget,
  overrides: Partial<Pick<RegisteredUser, 'email' | 'password' | 'name'>> = {},
): Promise<RegisteredUser> {
  const email = overrides.email ?? uniqueEmail('login');
  const password = overrides.password ?? TEST_PASSWORD;
  const name = overrides.name ?? 'Test User';

  const res = await request(server).post('/api/v1/auth/register').send({ email, password, name });

  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { id: res.body.data.id, email: res.body.data.email, password, name };
}

export function findSetCookie(header: unknown, name: string): string | undefined {
  const values = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];

  return values.find(
    (value): value is string => typeof value === 'string' && value.startsWith(`${name}=`),
  );
}

export function cookieValue(setCookie: string): string {
  const [pair] = setCookie.split(';');
  return pair.slice(pair.indexOf('=') + 1);
}

export interface LoginSession {
  accessToken: string;
  setCookie: string;
  rawToken: string;
}

export async function loginUser(
  server: SuperTestTarget,
  user: Pick<RegisteredUser, 'email' | 'password'>,
): Promise<LoginSession> {
  const res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });

  if (res.status !== 200) {
    throw new Error(`loginUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const setCookie = findSetCookie(res.headers['set-cookie'], 'bl_refresh');
  if (!setCookie) {
    throw new Error('loginUser did not receive a bl_refresh cookie');
  }

  return {
    accessToken: res.body.data.accessToken,
    setCookie,
    rawToken: cookieValue(setCookie),
  };
}
