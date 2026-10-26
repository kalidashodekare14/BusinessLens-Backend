import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { createTestApp, type TestApp } from '../helpers/test-app';
import {
  createIsolationFixture,
  TENANT_TABLES,
  type IsolationFixture,
  type TenantDb,
  type TenantTable,
} from '../helpers/isolation';

/** One tenant table plus the operations its RLS policy must block across organizations. */
interface RowCase {
  table: TenantTable;
  aId: string;
  bId: string;
  find: (db: TenantDb, id: string) => Promise<unknown | null>;
  list: (db: TenantDb, organizationIds: string[]) => Promise<Array<{ id: string }>>;
  update?: (db: TenantDb, id: string) => Promise<{ count: number }>;
  remove?: (db: TenantDb, id: string) => Promise<{ count: number }>;
  insertForeign: (db: TenantDb) => Promise<unknown>;
}

function buildCases(fixture: IsolationFixture): Map<TenantTable, RowCase> {
  const { a, b } = fixture;
  const cases: RowCase[] = [
    {
      table: 'ImportJob',
      aId: a.ids.importJob,
      bId: b.ids.importJob,
      find: (db, id) => db.importJob.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.importJob.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) => db.importJob.updateMany({ where: { id }, data: { status: 'MAPPED' } }),
      remove: (db, id) => db.importJob.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.importJob.create({
          data: {
            organizationId: b.organizationId,
            createdById: a.userId,
            type: 'PRODUCTS',
            originalFileName: 'foreign.csv',
            storagePath: '/tmp/foreign.csv',
          },
        }),
    },
    {
      table: 'Product',
      aId: a.ids.product,
      bId: b.ids.product,
      find: (db, id) => db.product.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.product.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) =>
        db.product.updateMany({ where: { id }, data: { name: `stolen-${randomUUID()}` } }),
      remove: (db, id) => db.product.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.product.create({
          data: { organizationId: b.organizationId, name: `foreign-${randomUUID()}` },
        }),
    },
    {
      table: 'Order',
      aId: a.ids.order,
      bId: b.ids.order,
      find: (db, id) => db.order.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.order.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) => db.order.updateMany({ where: { id }, data: { status: 'refunded' } }),
      remove: (db, id) => db.order.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.order.create({
          data: {
            organizationId: b.organizationId,
            externalId: `foreign-${randomUUID()}`,
            orderedAt: new Date('2026-02-01T00:00:00.000Z'),
            total: '1.00',
          },
        }),
    },
    {
      table: 'OrderItem',
      aId: a.ids.orderItem,
      bId: b.ids.orderItem,
      find: (db, id) => db.orderItem.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.orderItem.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) => db.orderItem.updateMany({ where: { id }, data: { quantity: 99 } }),
      remove: (db, id) => db.orderItem.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.orderItem.create({
          data: {
            organizationId: b.organizationId,
            orderId: b.ids.order,
            productName: 'foreign',
            quantity: 1,
            unitPrice: '1.00',
            lineTotal: '1.00',
          },
        }),
    },
    {
      table: 'AnalysisRun',
      aId: a.ids.analysisRun,
      bId: b.ids.analysisRun,
      find: (db, id) => db.analysisRun.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.analysisRun.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) => db.analysisRun.updateMany({ where: { id }, data: { status: 'RUNNING' } }),
      remove: (db, id) => db.analysisRun.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.analysisRun.create({
          data: { organizationId: b.organizationId, triggeredById: a.userId },
        }),
    },
    {
      table: 'Finding',
      aId: a.ids.finding,
      bId: b.ids.finding,
      find: (db, id) => db.finding.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.finding.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) =>
        db.finding.updateMany({ where: { id }, data: { status: 'INVESTIGATING' } }),
      remove: (db, id) => db.finding.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.finding.create({
          data: {
            organizationId: b.organizationId,
            analysisRunId: b.ids.analysisRun,
            type: 'ORDER_COUNT_DROP',
            severity: 'HIGH',
            title: 'foreign finding',
            evidence: { metric: 'orderCount' },
            ruleVersion: 'fixture-v1',
          },
        }),
    },
    {
      table: 'FindingNote',
      aId: a.ids.findingNote,
      bId: b.ids.findingNote,
      find: (db, id) => db.findingNote.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.findingNote.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) => db.findingNote.updateMany({ where: { id }, data: { body: 'stolen' } }),
      remove: (db, id) => db.findingNote.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.findingNote.create({
          data: {
            organizationId: b.organizationId,
            findingId: b.ids.finding,
            authorId: a.userId,
            body: 'foreign note',
          },
        }),
    },
    {
      table: 'AiExplanation',
      aId: a.ids.aiExplanation,
      bId: b.ids.aiExplanation,
      find: (db, id) => db.aiExplanation.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.aiExplanation.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      update: (db, id) =>
        db.aiExplanation.updateMany({ where: { id }, data: { status: 'GENERATING' } }),
      remove: (db, id) => db.aiExplanation.deleteMany({ where: { id } }),
      insertForeign: (db) =>
        db.aiExplanation.create({
          data: { organizationId: b.organizationId, findingId: b.ids.spareFinding },
        }),
    },
    {
      table: 'AuditLog',
      aId: a.ids.auditLog,
      bId: b.ids.auditLog,
      find: (db, id) => db.auditLog.findUnique({ where: { id } }),
      list: (db, organizationIds) =>
        db.auditLog.findMany({
          where: { organizationId: { in: organizationIds } },
          select: { id: true },
        }),
      // AuditLog is append-only for app_user: UPDATE and DELETE are not granted.
      insertForeign: (db) =>
        db.auditLog.create({
          data: { organizationId: b.organizationId, action: 'test.foreign_audit' },
        }),
    },
  ];

  return new Map(cases.map((rowCase) => [rowCase.table, rowCase]));
}

describe('tenant isolation at the database level (RLS, app_user)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let fixture: IsolationFixture;
  let cases: Map<TenantTable, RowCase>;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    tenantPrisma = ctx.app.get(TenantPrismaService);
    fixture = await createIsolationFixture(prisma, tenantPrisma);
    cases = buildCases(fixture);
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
    await ctx?.close();
  });

  it('seeds one row per tenant table for both organizations', () => {
    expect([...cases.keys()].sort()).toEqual([...TENANT_TABLES].sort());

    for (const table of TENANT_TABLES) {
      const rowCase = cases.get(table) as RowCase;
      expect(rowCase.aId).toBeTruthy();
      expect(rowCase.bId).toBeTruthy();
      expect(rowCase.aId).not.toBe(rowCase.bId);
    }
  });

  for (const table of TENANT_TABLES) {
    it(`${table}: isolates reads, writes, deletes and inserts between organizations`, async () => {
      const rowCase = cases.get(table) as RowCase;
      const { a, b } = fixture;

      // Own row is visible under the matching context.
      await expect(
        tenantPrisma.run(a.organizationId, (tx) => rowCase.find(tx, rowCase.aId)),
      ).resolves.not.toBeNull();

      // Another organization's row is invisible even when its id is known.
      await expect(
        tenantPrisma.run(a.organizationId, (tx) => rowCase.find(tx, rowCase.bId)),
      ).resolves.toBeNull();

      // Listing is scoped to the context organization (Finding also seeds a spare row).
      const ownRows = await tenantPrisma.run(a.organizationId, (tx) =>
        rowCase.list(tx, [a.organizationId, b.organizationId]),
      );
      const ownRowIds = ownRows.map((row) => row.id);
      expect(ownRowIds).toContain(rowCase.aId);
      expect(ownRowIds).not.toContain(rowCase.bId);

      // No context returns zero rows (fail closed).
      const noContextRows: Array<{ id: string }> = await rowCase.list(
        prisma as unknown as TenantDb,
        [a.organizationId, b.organizationId],
      );
      expect(noContextRows).toEqual([]);

      // Cross-organization updates are no-ops.
      if (rowCase.update) {
        const update = rowCase.update;
        await expect(
          tenantPrisma.run(a.organizationId, (tx) => update(tx, rowCase.bId)),
        ).resolves.toEqual({ count: 0 });

        await expect(
          tenantPrisma.run(b.organizationId, (tx) => rowCase.find(tx, rowCase.bId)),
        ).resolves.not.toBeNull();
      }

      // Cross-organization deletes are no-ops.
      if (rowCase.remove) {
        const remove = rowCase.remove;
        await expect(
          tenantPrisma.run(a.organizationId, (tx) => remove(tx, rowCase.bId)),
        ).resolves.toEqual({ count: 0 });

        await expect(
          tenantPrisma.run(b.organizationId, (tx) => rowCase.find(tx, rowCase.bId)),
        ).resolves.not.toBeNull();
      }

      // Inserting a row for another organization under A's context is rejected.
      await expect(
        tenantPrisma.run(a.organizationId, (tx) => rowCase.insertForeign(tx)),
      ).rejects.toThrow();
    });
  }
});
