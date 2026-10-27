import { Prisma } from '../../../../src/generated/prisma/client';
import {
  MAX_DECIMAL_12_2,
  groupOrderRows,
  type OrderLineRow,
} from '../../../../src/modules/imports/csv/order-grouper';

const ORDER_DATE = new Date('2026-01-01T00:00:00.000Z');

function line(overrides: Partial<OrderLineRow> = {}): OrderLineRow {
  return {
    rowNumber: 1,
    orderId: 'A-1',
    orderedAt: ORDER_DATE,
    status: 'completed',
    productName: 'Widget',
    sku: null,
    quantity: 1,
    unitPrice: new Prisma.Decimal('10.00'),
    ...overrides,
  };
}

describe('groupOrderRows', () => {
  it('groups non-adjacent rows and keeps first-seen order and item order', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1, orderId: 'A-1', productName: 'Widget' }),
      line({ rowNumber: 2, orderId: 'B-1', productName: 'Gadget' }),
      line({ rowNumber: 3, orderId: 'A-1', productName: 'Gizmo' }),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.failedRowNumbers.size).toBe(0);
    expect(result.orders.map((order) => order.externalId)).toEqual(['A-1', 'B-1']);
    expect(result.orders[0].rowNumbers).toEqual([1, 3]);
    expect(result.orders[0].items.map((item) => item.productName)).toEqual(['Widget', 'Gizmo']);
    expect(result.orders[0].total.toFixed(2)).toBe('20.00');
  });

  it('computes exact line and order totals', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1, quantity: 3, unitPrice: new Prisma.Decimal('0.10') }),
      line({
        rowNumber: 2,
        productName: 'Gadget',
        quantity: 2,
        unitPrice: new Prisma.Decimal('19.99'),
      }),
    ]);

    const order = result.orders[0];
    expect(order.items.map((item) => item.lineTotal.toFixed(2))).toEqual(['0.30', '39.98']);
    expect(order.total.toFixed(2)).toBe('40.28');
  });

  it('uses the first accepted row order fields and rejects conflicting rows', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1 }),
      line({ rowNumber: 2, orderedAt: new Date('2026-01-02T00:00:00.000Z') }),
      line({ rowNumber: 3, status: 'cancelled' }),
    ]);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].items.map((item) => item.rowNumber)).toEqual([1]);
    expect(result.orders[0].total.toFixed(2)).toBe('10.00');
    expect([...result.failedRowNumbers]).toEqual([2, 3]);
    expect(result.issues).toEqual([
      { rowNumber: 2, field: 'orderedAt', reason: 'conflicts with another row for the same order' },
      { rowNumber: 3, field: 'status', reason: 'conflicts with another row for the same order' },
    ]);
  });

  it('treats status casing as the same order value', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1, status: 'Completed' }),
      line({ rowNumber: 2, status: 'completed' }),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.orders[0].status).toBe('Completed');
    expect(result.orders[0].items).toHaveLength(2);
  });

  it('reports both order-level conflicts on one row', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1 }),
      line({
        rowNumber: 2,
        orderedAt: new Date('2026-01-02T00:00:00.000Z'),
        status: 'cancelled',
      }),
    ]);

    expect(result.issues.map((issue) => issue.field)).toEqual(['orderedAt', 'status']);
    expect([...result.failedRowNumbers]).toEqual([2]);
    expect(result.orders[0].items).toHaveLength(1);
  });

  it('rejects a line total above Decimal(12,2)', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1, quantity: 2, unitPrice: MAX_DECIMAL_12_2 }),
    ]);

    expect(result.orders).toEqual([]);
    expect([...result.failedRowNumbers]).toEqual([1]);
    expect(result.issues).toEqual([
      {
        rowNumber: 1,
        field: 'unitPrice',
        reason: 'line total exceeds the maximum supported amount',
      },
    ]);
  });

  it('does not let an overflowed line establish the order fields', () => {
    const result = groupOrderRows([
      line({
        rowNumber: 1,
        orderedAt: new Date('2026-01-02T00:00:00.000Z'),
        quantity: 2,
        unitPrice: MAX_DECIMAL_12_2,
      }),
      line({ rowNumber: 2 }),
    ]);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ rowNumber: 1, field: 'unitPrice' });
    expect(result.orders[0].orderedAt.toISOString()).toBe(ORDER_DATE.toISOString());
    expect(result.orders[0].items.map((item) => item.rowNumber)).toEqual([2]);
  });

  it('drops an order whose total exceeds Decimal(12,2)', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1, unitPrice: MAX_DECIMAL_12_2 }),
      line({ rowNumber: 2, unitPrice: new Prisma.Decimal('0.01') }),
    ]);

    expect(result.orders).toEqual([]);
    expect([...result.failedRowNumbers]).toEqual([1, 2]);
    expect(result.issues).toEqual([
      {
        rowNumber: 1,
        field: 'unitPrice',
        reason: 'order total exceeds the maximum supported amount',
      },
      {
        rowNumber: 2,
        field: 'unitPrice',
        reason: 'order total exceeds the maximum supported amount',
      },
    ]);
  });

  it('allows a line and order total exactly at the maximum', () => {
    const result = groupOrderRows([
      line({ rowNumber: 1, unitPrice: MAX_DECIMAL_12_2 }),
      line({ rowNumber: 2, unitPrice: new Prisma.Decimal('0') }),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].items[0].lineTotal.toFixed(2)).toBe('9999999999.99');
    expect(result.orders[0].total.toFixed(2)).toBe('9999999999.99');
  });

  it('returns no orders for no rows', () => {
    expect(groupOrderRows([])).toEqual({
      orders: [],
      issues: [],
      failedRowNumbers: new Set(),
    });
  });
});
