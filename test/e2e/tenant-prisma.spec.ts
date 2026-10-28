import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { createTestApp, type TestApp } from '../helpers/test-app';

describe('TenantPrismaService (e2e)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    tenantPrisma = ctx.app.get(TenantPrismaService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('scopes every transaction to one organization and does not leak context', async () => {
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const productName = `tenant-prisma-${randomUUID()}`;

    try {
      const created = await tenantPrisma.run(organizationA, (tx) =>
        tx.product.create({
          data: { organizationId: organizationA, name: productName },
        }),
      );
      expect(created.organizationId).toBe(organizationA);

      // set_config is transaction-local, so the next query has no context.
      await expect(prisma.product.findMany({ where: { name: productName } })).resolves.toEqual([]);

      const ownRows = await tenantPrisma.run(organizationA, (tx) =>
        tx.product.findMany({ where: { name: productName } }),
      );
      expect(ownRows).toHaveLength(1);
      expect(ownRows[0].organizationId).toBe(organizationA);

      const otherRows = await tenantPrisma.run(organizationB, (tx) =>
        tx.product.findMany({ where: { name: productName } }),
      );
      expect(otherRows).toEqual([]);

      await expect(
        tenantPrisma.run(organizationA, (tx) =>
          tx.product.create({
            data: { organizationId: organizationB, name: `${productName}-cross` },
          }),
        ),
      ).rejects.toThrow();

      await expect(
        prisma.product.findMany({ where: { name: { startsWith: productName } } }),
      ).resolves.toEqual([]);
    } finally {
      await tenantPrisma.run(organizationA, (tx) =>
        tx.product.deleteMany({ where: { name: { startsWith: productName } } }),
      );
      await tenantPrisma.run(organizationB, (tx) =>
        tx.product.deleteMany({ where: { name: { startsWith: productName } } }),
      );
    }
  });
});
