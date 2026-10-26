/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/test/integration/',
    '<rootDir>/test/e2e/',
    '<rootDir>/test/isolation/',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};
