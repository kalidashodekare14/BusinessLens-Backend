export const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://businesslens:secret@localhost:5433/businesslens',
  DATABASE_MIGRATION_URL: 'postgresql://owner:secret@localhost:5433/businesslens',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  CORS_ORIGIN: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  COOKIE_SAMESITE: 'lax',
  UPLOAD_DIR: './uploads',
  GEMINI_API_KEY: 'your-gemini-api-key',
  GEMINI_MODEL: 'your-gemini-model',
  AI_ENABLED: 'true',
};

export const REQUIRED_KEYS = Object.keys(VALID_ENV) as (keyof NodeJS.ProcessEnv)[];

/**
 * Writes the given values into process.env for the required keys and returns a
 * function that restores the previous state. Needed because ConfigModule validates
 * the real process.env at import time.
 */
export function setTestEnv(overrides: NodeJS.ProcessEnv = VALID_ENV): () => void {
  const original: Record<string, string | undefined> = {};

  for (const key of REQUIRED_KEYS) {
    original[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const key of REQUIRED_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key] as string;
      }
    }
  };
}
