import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

/**
 * Two users, two organizations, and one row in every tenant table per
 * organization (PROJECT_ARCHITECTURE.md §6.3). Rows are written through
 * TenantPrismaService, so the fixture itself proves the production write path.
 */

/** Every tenant table in the schema. AuditLog is append-only and read-only here. */
export const TENANT_TABLES = [
  'ImportJob',
  'Product',
  'Order',
  'OrderItem',
  'AnalysisRun',
  'Finding',
  'FindingNote',
  'AiExplanation',
  'AuditLog',
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

/** Minimal delegate surface shared by PrismaService and an interactive transaction. */
export type TenantDb = Pick<
  Prisma.TransactionClient,
  | 'importJob'
  | 'product'
  | 'order'
  | 'orderItem'
  | 'analysisRun'
  | 'finding'
  | 'findingNote'
  | 'aiExplanation'
  | 'auditLog'
>;

export interface TenantRowIds {
  importJob: string;
  product: string;
  order: string;
  orderItem: string;
  analysisRun: string;
  finding: string;
  /** Unused by AiExplanation; reserved for cross-organization insert probes. */
  spareFinding: string;
  findingNote: string;
  aiExplanation: string;
  auditLog: string;
}

export interface TenantSide {
  userId: string;
  organizationId: string;
  ids: TenantRowIds;
}

export interface IsolationFixture {
  a: TenantSide;
  b: TenantSide;
  cleanup: () => Promise<void>;
}

async function createSide(
  prisma: PrismaService,
  tenantPrisma: TenantPrismaService,
): Promise<TenantSide> {
  const suffix = randomUUID();

  // User/Organization/Membership have no RLS and are created through the app role.
  const user = await prisma.user.create({
    data: {
      email: `isolation-${suffix}@example.test`,
      passwordHash: 'fixture-hash-not-used-for-login',
      name: `Isolation User ${suffix}`,
    },
    select: { id: true },
  });

  const organization = await prisma.organization.create({
    data: { name: `Isolation Org ${suffix}` },
    select: { id: true },
  });

  await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
  });

  const organizationId = organization.id;
  const ids = await tenantPrisma.run(organizationId, async (tx) => {
    const importJob = await tx.importJob.create({
      data: {
        organizationId,
        createdById: user.id,
        type: 'ORDERS',
        originalFileName: `orders-${suffix}.csv`,
        storagePath: `/tmp/orders-${suffix}.csv`,
      },
      select: { id: true },
    });

    const product = await tx.product.create({
      data: { organizationId, name: `Product ${suffix}`, sku: `SKU-${suffix}`, price: '9.99' },
      select: { id: true },
    });

    const order = await tx.order.create({
      data: {
        organizationId,
        externalId: `order-${suffix}`,
        orderedAt: new Date('2026-01-01T00:00:00.000Z'),
        total: '19.98',
        importJobId: importJob.id,
      },
      select: { id: true },
    });

    const orderItem = await tx.orderItem.create({
      data: {
        organizationId,
        orderId: order.id,
        productId: product.id,
        productName: `Product ${suffix}`,
        quantity: 2,
        unitPrice: '9.99',
        lineTotal: '19.98',
      },
      select: { id: true },
    });

    const analysisRun = await tx.analysisRun.create({
      data: { organizationId, triggeredById: user.id, status: 'COMPLETED' },
      select: { id: true },
    });

    const findingData = {
      organizationId,
      analysisRunId: analysisRun.id,
      type: 'REVENUE_DROP' as const,
      severity: 'MEDIUM' as const,
      title: `Revenue dropped for ${suffix}`,
      evidence: { metric: 'revenue', current: '80.00', previous: '100.00' },
      ruleVersion: 'fixture-v1',
    };

    const finding = await tx.finding.create({ data: findingData, select: { id: true } });
    const spareFinding = await tx.finding.create({
      data: { ...findingData, title: `Spare finding for ${suffix}` },
      select: { id: true },
    });

    const findingNote = await tx.findingNote.create({
      data: {
        organizationId,
        findingId: finding.id,
        authorId: user.id,
        body: 'Fixture note',
      },
      select: { id: true },
    });

    const aiExplanation = await tx.aiExplanation.create({
      data: { organizationId, findingId: finding.id, status: 'PENDING' },
      select: { id: true },
    });

    const auditLog = await tx.auditLog.create({
      data: { organizationId, actorId: user.id, action: 'test.isolation_fixture' },
      select: { id: true },
    });

    return {
      importJob: importJob.id,
      product: product.id,
      order: order.id,
      orderItem: orderItem.id,
      analysisRun: analysisRun.id,
      finding: finding.id,
      spareFinding: spareFinding.id,
      findingNote: findingNote.id,
      aiExplanation: aiExplanation.id,
      auditLog: auditLog.id,
    };
  });

  return { userId: user.id, organizationId, ids };
}

async function deleteSide(
  prisma: PrismaService,
  tenantPrisma: TenantPrismaService,
  side: TenantSide,
): Promise<void> {
  const { organizationId } = side;

  // Children before parents; AuditLog rows cannot be deleted by app_user (append-only).
  await tenantPrisma.run(organizationId, async (tx) => {
    await tx.aiExplanation.deleteMany({ where: { organizationId } });
    await tx.findingNote.deleteMany({ where: { organizationId } });
    await tx.finding.deleteMany({ where: { organizationId } });
    await tx.analysisRun.deleteMany({ where: { organizationId } });
    await tx.orderItem.deleteMany({ where: { organizationId } });
    await tx.order.deleteMany({ where: { organizationId } });
    await tx.product.deleteMany({ where: { organizationId } });
    await tx.importJob.deleteMany({ where: { organizationId } });
  });

  await prisma.membership.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { id: side.userId } });
}

export async function createIsolationFixture(
  prisma: PrismaService,
  tenantPrisma: TenantPrismaService,
): Promise<IsolationFixture> {
  const a = await createSide(prisma, tenantPrisma);
  const b = await createSide(prisma, tenantPrisma);

  return {
    a,
    b,
    cleanup: async () => {
      await deleteSide(prisma, tenantPrisma, a);
      await deleteSide(prisma, tenantPrisma, b);
    },
  };
}
