import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * §6.3 / §3 of Agent.md: raw SQL on tenant tables is allowed only inside
 * `TenantPrismaService.run` (where the organization context is set), with a
 * comment explaining why. This scans the real source tree: only allowlisted
 * files may contain raw query calls, and in tenant-context files the calls must
 * go through the transaction client (`tx.`), never a bare client.
 */
const ALLOWED = new Map<string, 'tenant-context' | 'health-check'>([
  // Sets app.organization_id for every tenant transaction.
  [path.join('prisma', 'tenant-prisma.service.ts'), 'tenant-context'],
  // §9.2 SQL aggregates for periods/metrics, always on the run() transaction client.
  [path.join('modules', 'metrics', 'metrics.service.ts'), 'tenant-context'],
  // GET /health does `SELECT 1`; it touches no tenant table.
  [path.join('modules', 'health', 'health.service.ts'), 'health-check'],
]);

const RAW_CALL = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/;
const RAW_CALL_GLOBAL = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/g;

function countRawCalls(content: string): number {
  return (content.match(RAW_CALL_GLOBAL) ?? []).length;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'generated') {
        found.push(...sourceFiles(fullPath));
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(fullPath);
    }
  }
  return found;
}

describe('raw SQL convention (§6.3)', () => {
  const srcRoot = path.join(process.cwd(), 'src');
  const offenders: string[] = [];

  beforeAll(() => {
    for (const file of sourceFiles(srcRoot)) {
      const relative = path.relative(srcRoot, file);
      const content = readFileSync(file, 'utf8');
      if (RAW_CALL.test(content) && !ALLOWED.has(relative)) {
        offenders.push(relative);
      }
    }
  });

  it('keeps raw SQL out of every file outside the allowlist', () => {
    expect(offenders).toEqual([]);
  });

  it('runs tenant raw SQL only on the transaction client (inside TenantPrismaService.run)', () => {
    const metrics = readFileSync(
      path.join(srcRoot, 'modules', 'metrics', 'metrics.service.ts'),
      'utf8',
    );
    const rawCount = countRawCalls(metrics);
    const transactionCalls = metrics.match(/tx\.\$(queryRaw|executeRaw)/g) ?? [];
    expect(rawCount).toBeGreaterThan(0);
    expect(transactionCalls).toHaveLength(rawCount);
    expect(metrics).not.toMatch(/this\.prisma\.\$(queryRaw|executeRaw)/);
  });

  it('keeps the allowlist entries real (they still exist and document why)', () => {
    // Each allowlisted file must still contain raw SQL and the comment that
    // §6.3 requires next to it.
    const documentation = new Map<string, string>([
      // The context itself must set the transaction-local organization id.
      [path.join('prisma', 'tenant-prisma.service.ts'), 'set_config'],
      // §9.2 aggregates must say they run inside TenantPrismaService.run.
      [path.join('modules', 'metrics', 'metrics.service.ts'), 'TenantPrismaService.run'],
    ]);

    for (const [relative, kind] of ALLOWED) {
      const content = readFileSync(path.join(srcRoot, relative), 'utf8');
      expect(countRawCalls(content)).toBeGreaterThan(0);
      const marker = documentation.get(relative);
      if (kind === 'tenant-context') {
        expect(marker).toBeDefined();
        expect(content).toContain(marker as string);
      }
    }
  });
});
