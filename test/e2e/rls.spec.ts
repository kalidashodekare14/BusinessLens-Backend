import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, type TestApp } from '../helpers/test-app';

const TENANT_TABLES = [
  'ImportJob',
  'Product',
  'Order',
  'OrderItem',
  'AnalysisRun',
  'Finding',
  'FindingNote',
  'AiExplanation',
] as const;

interface TableState {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
}

interface GrantRow {
  table_name: string;
  privilege_type: string;
}

interface PolicyRow {
  table_name: string;
  polname: string;
  polcmd: string;
  using_expr: string | null;
  check_expr: string | null;
}

describe('RLS policies (e2e)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('enables and forces RLS on every tenant table', async () => {
    const rows = await prisma.$queryRaw<TableState[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const byName = new Map(rows.map((row) => [row.relname, row]));

    for (const table of [...TENANT_TABLES, 'AuditLog']) {
      expect(byName.get(table)).toMatchObject({
        relname: table,
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
    }
  });

  it('grants full tenant CRUD but keeps AuditLog append-only', async () => {
    const rows = await prisma.$queryRaw<GrantRow[]>`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_user' AND table_schema = 'public'
    `;
    const privileges = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = privileges.get(row.table_name) ?? new Set<string>();
      set.add(row.privilege_type);
      privileges.set(row.table_name, set);
    }

    for (const table of TENANT_TABLES) {
      expect(privileges.get(table)).toEqual(new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']));
    }
    expect(privileges.get('AuditLog')).toEqual(new Set(['SELECT', 'INSERT']));
  });

  it('creates the expected policies and no AuditLog write policies', async () => {
    const rows = await prisma.$queryRaw<PolicyRow[]>`
      SELECT c.relname AS table_name, p.polname, p.polcmd::text AS polcmd,
             pg_get_expr(p.polqual, p.polrelid) AS using_expr,
             pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
    `;

    for (const table of TENANT_TABLES) {
      const policies = rows.filter((row) => row.table_name === table);
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ polcmd: '*' });
      expect(policies[0].using_expr).toContain('app.organization_id');
      expect(policies[0].using_expr).toContain('organizationId');
      expect(policies[0].check_expr).toContain('app.organization_id');
      expect(policies[0].check_expr).toContain('organizationId');
    }

    const auditPolicies = rows.filter((row) => row.table_name === 'AuditLog');
    const selectPolicy = auditPolicies.find((row) => row.polname === 'audit_log_select');
    const insertPolicy = auditPolicies.find((row) => row.polname === 'audit_log_insert');

    expect(auditPolicies).toHaveLength(2);
    expect(selectPolicy?.polcmd).toBe('r');
    expect(selectPolicy?.using_expr).toContain('app.organization_id');
    expect(insertPolicy?.polcmd).toBe('a');
    expect(insertPolicy?.check_expr).toContain('IS NULL');
    expect(insertPolicy?.check_expr).toContain('app.organization_id');
    expect(auditPolicies.some((row) => row.polcmd === 'w' || row.polcmd === 'd')).toBe(false);
  });

  it('keeps app_user least-privileged', async () => {
    const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user'
    `;

    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('fails closed without a context and isolates Product by organization', async () => {
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const productName = `rls-${randomUUID()}`;

    async function withContext<T>(
      organizationId: string,
      run: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
        return run(tx);
      });
    }

    try {
      await withContext(organizationA, (tx) =>
        tx.product.create({ data: { organizationId: organizationA, name: productName } }),
      );

      await expect(prisma.product.findMany({ where: { name: productName } })).resolves.toEqual([]);

      const ownRows = await withContext(organizationA, (tx) =>
        tx.product.findMany({ where: { name: productName } }),
      );
      expect(ownRows).toHaveLength(1);
      expect(ownRows[0].organizationId).toBe(organizationA);

      const otherRows = await withContext(organizationB, (tx) =>
        tx.product.findMany({ where: { name: productName } }),
      );
      expect(otherRows).toEqual([]);

      await expect(
        withContext(organizationA, (tx) =>
          tx.product.create({
            data: { organizationId: organizationB, name: `${productName}-cross` },
          }),
        ),
      ).rejects.toThrow();

      const foreignUpdate = await withContext(organizationB, (tx) =>
        tx.product.updateMany({
          where: { name: productName },
          data: { name: `${productName}-stolen` },
        }),
      );
      expect(foreignUpdate.count).toBe(0);
    } finally {
      await withContext(organizationA, (tx) =>
        tx.product.deleteMany({ where: { name: { startsWith: productName } } }),
      );
    }
  });
});
