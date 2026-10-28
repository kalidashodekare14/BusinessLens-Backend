import path from 'node:path';
import { ESLint } from 'eslint';

/**
 * Verifies the real eslint.config.mjs rule (not a copy): tenant modules must not
 * import PrismaService directly, while the non-tenant modules keep their exception.
 */
describe('tenant module PrismaService convention', () => {
  const projectRoot = process.cwd();
  const tenantModuleFiles = [
    path.join(projectRoot, 'src/modules/catalog/products.service.ts'),
    // New in T6.2: the demo loader is a tenant module like any other.
    path.join(projectRoot, 'src/modules/demo/demo.service.ts'),
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
      tenantModuleFiles.map((file) => [specifier, file] as const),
    ),
  )(
    'rejects a direct PrismaService import (%s) in a tenant module (%s)',
    async (specifier, filePath) => {
      const messages = await restrictedImportMessages(
        `import { PrismaService } from '${specifier}';\n`,
        filePath,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ ruleId: 'no-restricted-imports', severity: 2 });
    },
  );

  it.each(tenantModuleFiles)(
    'allows TenantPrismaService in a tenant module (%s)',
    async (filePath) => {
      const messages = await restrictedImportMessages(
        "import { TenantPrismaService } from '../../prisma/tenant-prisma.service';\n",
        filePath,
      );

      expect(messages).toEqual([]);
    },
  );

  it('keeps PrismaService available to the non-tenant modules', async () => {
    const messages = await restrictedImportMessages(
      "import { PrismaService } from '../../prisma/prisma.service';\n",
      nonTenantModuleFile,
    );

    expect(messages).toEqual([]);
  });
});
