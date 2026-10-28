import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-seed/**',
      'node_modules/**',
      'coverage/**',
      'sample-data/**',
      'src/generated/**',
      '*.tsbuildinfo',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Tenant modules and queue processors must go through TenantPrismaService
    // (PROJECT_ARCHITECTURE.md §6.2–6.3). The excluded modules only touch
    // non-tenant tables, or (audit) the dedicated null-organization audit path
    // that runs before a tenant context exists.
    files: ['src/modules/**/*.ts', 'src/queues/**/*.ts'],
    ignores: [
      'src/modules/auth/**',
      'src/modules/users/**',
      'src/modules/organizations/**',
      'src/modules/audit/**',
      'src/modules/health/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/prisma/prisma.service'],
              message:
                'Tenant modules must use TenantPrismaService (TenantContextService in request code), never PrismaService directly.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
