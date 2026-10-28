import { z } from 'zod';

export type NodeEnv = 'development' | 'production' | 'test';

export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  databaseMigrationUrl: string;
  redisUrl: string;
  jwtAccessSecret: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  uploadDir: string;
  geminiApiKey: string;
  geminiModel: string;
  aiEnabled: boolean;
}

export class ConfigValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      ['CONFIG_INVALID: environment is missing or invalid', ...issues.map((i) => `  - ${i}`)].join(
        '\n',
      ),
    );
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

const enumOf = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .refine(
      (v) => (values as readonly string[]).includes(v),
      `must be one of ${values.join(' | ')}`,
    )
    .transform((v) => v as T);

const booleanString = () =>
  z
    .string()
    .refine((v) => ['true', 'false', '1', '0'].includes(v), 'must be true or false')
    .transform((v) => v === 'true' || v === '1');

const portString = () =>
  z
    .string()
    .refine((v) => /^\d+$/.test(v), 'must be a positive integer')
    .refine((v) => Number(v) >= 1 && Number(v) <= 65535, 'must be between 1 and 65535')
    .transform((v) => Number(v));

const postgresUrl = () =>
  z.string().refine((v) => /^postgres(ql)?:\/\/\S+$/.test(v), 'must be a postgresql:// URL');

const redisUrl = () =>
  z.string().refine((v) => /^rediss?:\/\/\S+$/.test(v), 'must be a redis:// or rediss:// URL');

const originList = () =>
  z
    .string()
    .min(1, 'must not be empty')
    .refine(
      (v) => v.split(',').every((part) => /^https?:\/\/[^\s/]+$/.test(part.trim())),
      'must be a comma-separated list of origins with scheme and host only, e.g. http://localhost:5173',
    );

const envSchema = z
  .object({
    NODE_ENV: enumOf(['development', 'production', 'test'] as const),
    PORT: portString(),
    DATABASE_URL: postgresUrl(),
    DATABASE_MIGRATION_URL: postgresUrl(),
    REDIS_URL: redisUrl(),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    CORS_ORIGIN: originList(),
    COOKIE_SECURE: booleanString(),
    COOKIE_SAMESITE: enumOf(['lax', 'strict', 'none'] as const),
    UPLOAD_DIR: z.string().min(1, 'must not be empty'),
    GEMINI_API_KEY: z.string().min(1, 'must not be empty'),
    GEMINI_MODEL: z
      .string()
      .refine(
        (v) => /^[a-z0-9][a-z0-9._-]*$/i.test(v),
        'must be a model name such as gemini-2.5-flash',
      ),
    AI_ENABLED: booleanString(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.COOKIE_SAMESITE === 'none' && !cfg.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message: "SameSite 'none' requires COOKIE_SECURE=true",
      });
    }
    if (cfg.NODE_ENV === 'production' && !cfg.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true when NODE_ENV=production',
      });
    }
    if (cfg.DATABASE_URL === cfg.DATABASE_MIGRATION_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_MIGRATION_URL'],
        message: 'must differ from DATABASE_URL (app_user vs owner roles)',
      });
    }
  });

/**
 * Pure env -> typed config. Throws ConfigValidationError listing every problem at once,
 * so the process can refuse to start with one actionable message (PROJECT_ARCHITECTURE.md Â§15).
 * Error text never contains variable values, only variable names.
 */
export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.length > 0 ? String(issue.path[0]) : 'ENV';
      return `${key}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  const raw = result.data;
  return {
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL,
    databaseMigrationUrl: raw.DATABASE_MIGRATION_URL,
    redisUrl: raw.REDIS_URL,
    jwtAccessSecret: raw.JWT_ACCESS_SECRET,
    corsOrigins: raw.CORS_ORIGIN.split(',').map((part) => part.trim()),
    cookieSecure: raw.COOKIE_SECURE,
    cookieSameSite: raw.COOKIE_SAMESITE,
    uploadDir: raw.UPLOAD_DIR,
    geminiApiKey: raw.GEMINI_API_KEY,
    geminiModel: raw.GEMINI_MODEL,
    aiEnabled: raw.AI_ENABLED,
  };
}

/** Bootstrap helper for entry points without DI yet: print the aggregated message and exit(1). */
export function loadConfigOrExit(env: NodeJS.ProcessEnv): AppConfig {
  try {
    return parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
