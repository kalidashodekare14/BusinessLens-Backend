import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { Prisma } from '../../src/generated/prisma/client';

/**
 * Proves the runtime connection path end to end: PrismaClient -> pg driver adapter
 * -> DATABASE_URL (app_user role). Run with `npm run test:e2e`; requires the
 * docker-compose Postgres and both migrations to be applied.
 */
describe('database connectivity (real Postgres, app_user)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('connects as app_user', async () => {
    const rows = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(rows).toHaveLength(1);
    expect(rows[0].current_user).toBe('app_user');
  });

  it('runs with least privileges (no superuser, no BYPASSRLS, no CREATEROLE/CREATEDB)', async () => {
    const rows = await prisma.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }[]
    >`
      SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_roles WHERE rolname = 'app_user'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it('sees all 13 migrated tables in the public schema', async () => {
    const expected = [
      'User',
      'Organization',
      'Membership',
      'RefreshToken',
      'ImportJob',
      'Product',
      'Order',
      'OrderItem',
      'AnalysisRun',
      'Finding',
      'FindingNote',
      'AiExplanation',
      'AuditLog',
    ];
    // pg_catalog is readable by every role, so this works before T2.1 grants exist.
    const rows = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${Prisma.join(expected)})`;
    expect(rows.map((r) => r.relname).sort()).toEqual([...expected].sort());
  });
});
