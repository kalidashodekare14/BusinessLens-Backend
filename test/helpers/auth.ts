import { randomUUID } from 'node:crypto';

/** Unique per test run so parallel suites never collide on the unique email. */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/** Meets the 10-character minimum; used verbatim in tests. */
export const TEST_PASSWORD = 'correct horse battery staple';
