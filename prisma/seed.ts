/**
 * T6.2 — loads the sample dataset into a demo organization (§16: `npm run seed`).
 *
 * The import runs through DemoDataService, i.e. the exact upload → mapping →
 * confirm path a client uses (row validation, idempotent upserts, audit events);
 * only the HTTP layer is skipped. The jobs are queued, so the worker must be
 * running (or started afterwards) to finish processing.
 *
 * Executed compiled (`tsc -p tsconfig.seed.json`): Node cannot run this file
 * directly because the Nest modules it imports use legacy decorators, which
 * Node's type stripping does not transform.
 */
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { DemoDataService } from '../src/modules/demo/demo.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { OrganizationsService } from '../src/modules/organizations/organizations.service';
import { UsersService } from '../src/modules/users/users.service';

/** Local demo identity only; documented in README.md, never a real account. */
const DEMO_EMAIL = 'demo@businesslens.test';
const DEMO_PASSWORD = 'businesslens-demo';
const DEMO_USER_NAME = 'Demo User';
const DEMO_ORG_NAME = 'Demo Organization';

function errorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const message = (response as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function seed(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    // Same abortOnError contract as src/main.ts: config errors reject here
    // instead of exiting inside Nest's exception handler.
    app = await NestFactory.createApplicationContext(AppModule, { abortOnError: false });

    const users = app.get(UsersService);
    const auth = app.get(AuthService);
    const organizations = app.get(OrganizationsService);
    const demo = app.get(DemoDataService);

    const existingUser = await users.findByEmail(DEMO_EMAIL);
    const user =
      existingUser ??
      (await auth.register({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        name: DEMO_USER_NAME,
      }));

    const owned = await organizations.listForUser(user.id, 1, 100);
    const existingOrg = owned.data.find((organization) => organization.name === DEMO_ORG_NAME);
    const organization =
      existingOrg ?? (await organizations.create(user.id, { name: DEMO_ORG_NAME }));

    const result = await demo.load(organization.id, user.id);

    console.log('Demo data queued successfully.');
    console.log(`  user:    ${DEMO_EMAIL} (demo password documented in README.md)`);
    console.log(`  org:     ${organization.id} (${DEMO_ORG_NAME})`);
    for (const entry of result.imports) {
      console.log(`  import:  ${entry.id} (${entry.type}) → ${entry.status}`);
    }
    console.log('');
    console.log('The worker finishes the import (start it with `docker compose up -d` or');
    console.log('`npm run start:worker`). Then sign in and poll GET /api/v1/organizations');
    console.log(`/${organization.id}/imports until both imports are COMPLETED.`);
  } catch (error) {
    console.error(`Seed failed: ${errorMessage(error)}`);
    if (error instanceof HttpException && error.getStatus() === 503) {
      console.error(
        'Redis appears unreachable — start it (docker compose up -d postgres redis) and re-run `npm run seed`.',
      );
    }
    process.exitCode = 1;
  } finally {
    // Audit writes are fire-and-forget by design (§6.5); give the in-flight
    // inserts a moment to commit before the connection pool closes.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await app?.close();
  }
}

void seed();
