import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  ConfigValidationError,
  loadConfigOrExit,
  parseConfig,
} from '../../../src/config/configuration';
import { REQUIRED_KEYS, setTestEnv, VALID_ENV } from '../../helpers/valid-env';

const withEnv = (overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...VALID_ENV,
  ...overrides,
});

const issuesOf = (env: NodeJS.ProcessEnv): string[] => {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected parseConfig to throw ConfigValidationError');
};

const messageOf = (env: NodeJS.ProcessEnv): string => {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('expected parseConfig to throw ConfigValidationError');
};

describe('parseConfig', () => {
  it('accepts a valid environment and coerces types', () => {
    const cfg = parseConfig(VALID_ENV);

    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.aiEnabled).toBe(true);
    expect(cfg.cookieSameSite).toBe('lax');
    expect(cfg.corsOrigins).toEqual(['http://localhost:5173']);
    expect(cfg.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
  });

  it('splits multiple CORS origins', () => {
    const cfg = parseConfig(
      withEnv({ CORS_ORIGIN: 'http://localhost:5173, https://app.example.com' }),
    );

    expect(cfg.corsOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it.each(REQUIRED_KEYS)('fails fast and names %s when it is missing', (key) => {
    const env = { ...VALID_ENV };
    delete env[key];

    expect(() => parseConfig(env)).toThrow(ConfigValidationError);
    const message = messageOf(env);
    expect(message).toContain('CONFIG_INVALID');
    expect(message).toMatch(new RegExp(`^\\s*- ${key}:`, 'm'));
  });

  it('reports every missing variable at once', () => {
    const env = { ...VALID_ENV };
    delete env.PORT;
    delete env.REDIS_URL;

    const message = messageOf(env);

    expect(message).toContain('CONFIG_INVALID');
    expect(message).toContain('PORT:');
    expect(message).toContain('REDIS_URL:');
  });

  it.each([
    ['PORT', 'abc', 'positive integer'],
    ['PORT', '0', 'between 1 and 65535'],
    ['PORT', '70000', 'between 1 and 65535'],
    ['NODE_ENV', 'staging', 'development | production | test'],
    ['DATABASE_URL', 'localhost:5433/db', 'postgresql:// URL'],
    ['DATABASE_MIGRATION_URL', 'http://x/db', 'postgresql:// URL'],
    ['REDIS_URL', 'http://localhost:6379', 'redis://'],
    ['JWT_ACCESS_SECRET', 'short', 'at least 32 characters'],
    ['CORS_ORIGIN', 'localhost:5173', 'origins with scheme and host'],
    ['CORS_ORIGIN', 'http://localhost:5173/app', 'origins with scheme and host'],
    ['COOKIE_SECURE', 'yes', 'true or false'],
    ['COOKIE_SAMESITE', 'None', 'lax | strict | none'],
    ['UPLOAD_DIR', '', 'must not be empty'],
    ['GEMINI_API_KEY', '', 'must not be empty'],
    ['GEMINI_MODEL', 'not a model!', 'model name'],
    ['AI_ENABLED', 'maybe', 'true or false'],
  ])('rejects %s=%s', (key, value, expected) => {
    const issues = issuesOf(withEnv({ [key]: value }));

    expect(issues.join('\n')).toMatch(new RegExp(`^${key}:`, 'm'));
    expect(issues.join('\n')).toContain(expected);
  });

  it('rejects SameSite=none when COOKIE_SECURE is false', () => {
    const issues = issuesOf(withEnv({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }));

    expect(issues.join('\n')).toContain('COOKIE_SAMESITE:');
    expect(issues.join('\n')).toContain('COOKIE_SECURE=true');
  });

  it('accepts SameSite=none when COOKIE_SECURE is true', () => {
    const cfg = parseConfig(withEnv({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }));

    expect(cfg.cookieSameSite).toBe('none');
    expect(cfg.cookieSecure).toBe(true);
  });

  it('rejects insecure cookies in production', () => {
    const issues = issuesOf(withEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }));

    expect(issues.join('\n')).toContain('COOKIE_SECURE:');
    expect(issues.join('\n')).toContain('must be true when NODE_ENV=production');
  });

  it('accepts secure cookies in production', () => {
    const cfg = parseConfig(
      withEnv({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        COOKIE_SAMESITE: 'none',
      }),
    );

    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.cookieSecure).toBe(true);
  });

  it('rejects identical database URLs (owner and app_user must differ)', () => {
    const issues = issuesOf(withEnv({ DATABASE_MIGRATION_URL: VALID_ENV.DATABASE_URL as string }));

    expect(issues.join('\n')).toContain('DATABASE_MIGRATION_URL:');
    expect(issues.join('\n')).toContain('differ from DATABASE_URL');
  });

  it('never puts variable values into the error message', () => {
    const issues = issuesOf(withEnv({ JWT_ACCESS_SECRET: 'super-secret-value-123' }));

    expect(issues.join('\n')).not.toContain('super-secret-value-123');
  });

  it('ignores unrelated environment variables', () => {
    const cfg = parseConfig({
      ...VALID_ENV,
      JEST_WORKER_ID: '1',
      PATH: '/usr/bin',
    } as NodeJS.ProcessEnv);

    expect(cfg.port).toBe(3000);
  });
});

describe('loadConfigOrExit', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number | string) => {
      throw new Error(`EXIT:${String(code)}`);
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('exits with code 1 and prints the aggregated message', () => {
    const env = { ...VALID_ENV };
    delete env.REDIS_URL;

    expect(() => loadConfigOrExit(env)).toThrow('EXIT:1');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('CONFIG_INVALID'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL:'));
  });

  it('returns the parsed config when the environment is valid', () => {
    expect(loadConfigOrExit(VALID_ENV).port).toBe(3000);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('ConfigModule', () => {
  let restoreEnv: () => void;

  afterEach(() => {
    restoreEnv();
  });

  it('refuses to build when the environment is invalid', async () => {
    restoreEnv = setTestEnv(withEnv({ PORT: 'not-a-port' }));

    let thrown: unknown;
    try {
      const builder = Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            validate: (env) => {
              parseConfig(env as NodeJS.ProcessEnv);
              return env as Record<string, string>;
            },
          }),
        ],
      });
      await builder.compile();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).toContain('CONFIG_INVALID');
    expect(String((thrown as Error).message)).toContain('PORT:');
  });

  it('builds when the environment is valid', async () => {
    restoreEnv = setTestEnv(VALID_ENV);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: (env) => {
            parseConfig(env as NodeJS.ProcessEnv);
            return env as Record<string, string>;
          },
        }),
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
