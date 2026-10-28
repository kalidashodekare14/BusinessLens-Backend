import { Test } from '@nestjs/testing';
import { setTestEnv, VALID_ENV } from '../helpers/valid-env';

type AppModuleType = typeof import('../../src/app.module').AppModule;

describe('AppModule', () => {
  let AppModule: AppModuleType;
  let restoreEnv: () => void;

  beforeAll(async () => {
    // ConfigModule validates process.env when src/app.module.ts is first imported,
    // so the environment must be valid before the dynamic import.
    restoreEnv = setTestEnv(VALID_ENV);
    AppModule = (await import('../../src/app.module')).AppModule;
  });

  afterAll(() => {
    restoreEnv();
  });

  it('compiles as an empty application shell', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef).toBeDefined();
  });
});
