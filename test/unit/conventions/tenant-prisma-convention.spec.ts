import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';

const NON_TENANT_MODULES = new Set(['auth', 'users', 'organizations', 'audit', 'health']);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(fullPath);
    }
  }
  return found;
}

/**
 * Verifies the real eslint.config.mjs rule (not a copy): tenant modules and the
 * queue layer must not import PrismaService directly, while the non-tenant
 * modules keep their exception. Every protected file is checked, so a stale
 * sample cannot hide a regression elsewhere.
 */
describe('tenant code PrismaService convention', () => {
  const projectRoot = process.cwd();
  const modulesRoot = path.join(projectRoot, 'src', 'modules');
  const tenantModuleFiles = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_TENANT_MODULES.has(entry.name))
    .flatMap((entry) => sourceFiles(path.join(modulesRoot, entry.name)));
  const protectedFiles = [
    ...tenantModuleFiles,
    ...sourceFiles(path.join(projectRoot, 'src', 'queues')),
  ];
  const nonTenantModuleFile = path.join(projectRoot, 'src/modules/auth/auth.service.ts');

  const eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: path.join(projectRoot, 'eslint.config.mjs'),
  });

  async function restrictedImportMessages(
    source: string,
    filePath: string,
  ): Promise<ESLint.LintResult['messages']> {
    const [result] = await eslint.lintText(source, { filePath });
    return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
  }

  it.each(
    [['../../prisma/prisma.service'], ['../../../prisma/prisma.service']].flatMap(([specifier]) =>
      protectedFiles.map((file) => [specifier, file] as const),
    ),
  )(
    'rejects a direct PrismaService import (%s) in tenant code (%s)',
    async (specifier, filePath) => {
      const messages = await restrictedImportMessages(
        `import { PrismaService } from '${specifier}';\n`,
        filePath,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ ruleId: 'no-restricted-imports', severity: 2 });
    },
  );

  it.each(protectedFiles)('allows TenantPrismaService in tenant code (%s)', async (filePath) => {
    const messages = await restrictedImportMessages(
      "import { TenantPrismaService } from '../../prisma/tenant-prisma.service';\n",
      filePath,
    );

    expect(messages).toEqual([]);
  });

  it('keeps PrismaService available to the non-tenant modules', async () => {
    const messages = await restrictedImportMessages(
      "import { PrismaService } from '../../prisma/prisma.service';\n",
      nonTenantModuleFile,
    );

    expect(messages).toEqual([]);
  });
});
