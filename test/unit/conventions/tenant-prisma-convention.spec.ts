import path from 'node:path';
import { ESLint } from 'eslint';

/**
 * Verifies the real eslint.config.mjs rule (not a copy): tenant modules must not
 * import PrismaService directly, while the non-tenant modules keep their exception.
 */
describe('tenant module PrismaService convention', () => {
  const projectRoot = process.cwd();
  const tenantModuleFile = path.join(projectRoot, 'src/modules/catalog/products.service.ts');
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

  it.each(['../../prisma/prisma.service', '../../../prisma/prisma.service'])(
    'rejects a direct PrismaService import (%s) in a tenant module',
    async (specifier) => {
      const messages = await restrictedImportMessages(
        `import { PrismaService } from '${specifier}';\n`,
        tenantModuleFile,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ ruleId: 'no-restricted-imports', severity: 2 });
    },
  );

  it('allows TenantPrismaService in a tenant module', async () => {
    const messages = await restrictedImportMessages(
      "import { TenantPrismaService } from '../../prisma/tenant-prisma.service';\n",
      tenantModuleFile,
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
