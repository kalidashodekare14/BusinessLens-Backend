import { randomUUID } from 'node:crypto';
import { TenantJobPayloadError, TenantJobRunner } from '../../src/queues/tenant-job-runner';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { createIsolationFixture, type IsolationFixture } from '../helpers/isolation';
import { createTestApp, type TestApp } from '../helpers/test-app';

describe('TenantJobRunner (isolation)', () => {
  let ctx: TestApp;
  let tenantPrisma: TenantPrismaService;
  let fixture: IsolationFixture;
  let runner: TenantJobRunner;

  beforeAll(async () => {
    ctx = await createTestApp();
    const prisma = ctx.app.get(PrismaService);
    tenantPrisma = ctx.app.get(TenantPrismaService);
    fixture = await createIsolationFixture(prisma, tenantPrisma);
    runner = new TenantJobRunner(tenantPrisma);
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
    await ctx?.close();
  });

  it('runs a job inside its own organization context', async () => {
    const product = await runner.run({ organizationId: fixture.a.organizationId }, (tx) =>
      tx.product.findUnique({ where: { id: fixture.a.ids.product } }),
    );

    expect(product).not.toBeNull();
    expect(product?.organizationId).toBe(fixture.a.organizationId);
  });

  it('rejects a payload without a valid organizationId before doing any work', async () => {
    const handler = jest.fn();

    await expect(runner.run({}, handler)).rejects.toBeInstanceOf(TenantJobPayloadError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps an org A job away from org B rows under every operation', async () => {
    const { a, b } = fixture;
    const bProductBefore = await runner.run({ organizationId: b.organizationId }, (tx) =>
      tx.product.findUnique({ where: { id: b.ids.product } }),
    );

    // Reads return zero rows even when the job knows B's ids.
    await expect(
      runner.run({ organizationId: a.organizationId }, (tx) =>
        tx.product.findMany({ where: { organizationId: b.organizationId } }),
      ),
    ).resolves.toEqual([]);

    await expect(
      runner.run({ organizationId: a.organizationId }, (tx) =>
        tx.product.findUnique({ where: { id: b.ids.product } }),
      ),
    ).resolves.toBeNull();

    // Updates and deletes affect no rows.
    await expect(
      runner.run({ organizationId: a.organizationId }, (tx) =>
        tx.product.updateMany({
          where: { id: b.ids.product },
          data: { name: `stolen-${randomUUID()}` },
        }),
      ),
    ).resolves.toEqual({ count: 0 });

    await expect(
      runner.run({ organizationId: a.organizationId }, (tx) =>
        tx.product.deleteMany({ where: { id: b.ids.product } }),
      ),
    ).resolves.toEqual({ count: 0 });

    // Writes carrying B's organizationId are rejected by WITH CHECK.
    await expect(
      runner.run({ organizationId: a.organizationId }, (tx) =>
        tx.product.create({
          data: { organizationId: b.organizationId, name: `foreign-${randomUUID()}` },
        }),
      ),
    ).rejects.toThrow();

    // B's row is untouched and still visible under B's context.
    await expect(
      runner.run({ organizationId: b.organizationId }, (tx) =>
        tx.product.findUnique({ where: { id: b.ids.product } }),
      ),
    ).resolves.toEqual(bProductBefore);
  });
});
