import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Owner role for all Prisma CLI/migrations; the app runtime uses app_user (DATABASE_URL).
    // Raw process.env (not the env() helper) so `prisma generate` also works on a fresh
    // clone before .env exists; migrate commands still fail fast when the URL is missing.
    url: process.env.DATABASE_MIGRATION_URL ?? '',
  },
});
