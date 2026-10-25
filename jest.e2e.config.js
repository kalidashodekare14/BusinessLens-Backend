/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/integration/**/*.spec.ts', '**/e2e/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  // Integration tests talk to the real Postgres/Redis from docker-compose.yml.
  testTimeout: 30000,
};
