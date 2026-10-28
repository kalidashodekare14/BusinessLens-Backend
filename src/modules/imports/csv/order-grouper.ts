import { Prisma } from '../../../generated/prisma/client';
import type { RowIssue, ValidatedOrderRow } from './row-validator';

export const MAX_DECIMAL_12_2 = new Prisma.Decimal('9999999999.99');

const LINE_TOTAL_OVERFLOW = 'line total exceeds the maximum supported amount';
const ORDER_TOTAL_OVERFLOW = 'order total exceeds the maximum supported amount';
const ORDER_FIELD_CONFLICT = 'conflicts with another row for the same order';

export interface OrderLineRow extends ValidatedOrderRow {
  readonly rowNumber: number;
}

export interface GroupedOrderItem {
  readonly rowNumber: number;
  readonly productName: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPrice: Prisma.Decimal;
  readonly lineTotal: Prisma.Decimal;
}

export interface GroupedOrder {
  readonly externalId: string;
  readonly orderedAt: Date;
  readonly status: string;
  readonly total: Prisma.Decimal;
  readonly items: readonly GroupedOrderItem[];
  /** Data rows that contributed an accepted line item. */
  readonly rowNumbers: readonly number[];
}

export interface OrderGroupingIssue extends RowIssue {
  readonly rowNumber: number;
}

export interface OrderGroupingResult {
  readonly orders: readonly GroupedOrder[];
  readonly issues: readonly OrderGroupingIssue[];
  readonly failedRowNumbers: ReadonlySet<number>;
}

interface MutableOrder {
  externalId: string;
  orderedAt: Date;
  status: string;
  total: Prisma.Decimal;
  items: GroupedOrderItem[];
  rowNumbers: number[];
}

function toItem(row: OrderLineRow, lineTotal: Prisma.Decimal): GroupedOrderItem {
  return {
    rowNumber: row.rowNumber,
    productName: row.productName,
    sku: row.sku,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal,
  };
}

/**
 * Groups validated ORDERS rows by external order id. Rows for one order are not
 * assumed to be adjacent: the whole file is grouped before any write, so a batch
 * boundary can never split an order or replace part of its items.
 *
 * The first row with an acceptable line establishes the order-level date and
 * status. Later rows with a different value are rejected individually rather
 * than dropping the whole order, so one bad row cannot hide the rest of its items.
 */
export function groupOrderRows(rows: readonly OrderLineRow[]): OrderGroupingResult {
  const groups = new Map<string, MutableOrder>();
  const issues: OrderGroupingIssue[] = [];
  const failedRowNumbers = new Set<number>();

  for (const row of rows) {
    const lineTotal = row.unitPrice.mul(row.quantity);

    if (lineTotal.greaterThan(MAX_DECIMAL_12_2)) {
      issues.push({
        rowNumber: row.rowNumber,
        field: 'unitPrice',
        reason: LINE_TOTAL_OVERFLOW,
      });
      failedRowNumbers.add(row.rowNumber);
      continue;
    }

    const existing = groups.get(row.orderId);
    if (!existing) {
      groups.set(row.orderId, {
        externalId: row.orderId,
        orderedAt: row.orderedAt,
        status: row.status,
        total: lineTotal,
        items: [toItem(row, lineTotal)],
        rowNumbers: [row.rowNumber],
      });
      continue;
    }

    let conflicted = false;
    if (row.orderedAt.getTime() !== existing.orderedAt.getTime()) {
      issues.push({
        rowNumber: row.rowNumber,
        field: 'orderedAt',
        reason: ORDER_FIELD_CONFLICT,
      });
      conflicted = true;
    }
    if (row.status.toLowerCase() !== existing.status.toLowerCase()) {
      issues.push({
        rowNumber: row.rowNumber,
        field: 'status',
        reason: ORDER_FIELD_CONFLICT,
      });
      conflicted = true;
    }
    if (conflicted) {
      failedRowNumbers.add(row.rowNumber);
      continue;
    }

    existing.total = existing.total.plus(lineTotal);
    existing.items.push(toItem(row, lineTotal));
    existing.rowNumbers.push(row.rowNumber);
  }

  const orders: GroupedOrder[] = [];
  for (const group of groups.values()) {
    if (group.total.greaterThan(MAX_DECIMAL_12_2)) {
      for (const rowNumber of group.rowNumbers) {
        issues.push({
          rowNumber,
          field: 'unitPrice',
          reason: ORDER_TOTAL_OVERFLOW,
        });
        failedRowNumbers.add(rowNumber);
      }
      continue;
    }

    orders.push({
      externalId: group.externalId,
      orderedAt: group.orderedAt,
      status: group.status,
      total: group.total,
      items: group.items,
      rowNumbers: group.rowNumbers,
    });
  }

  return { orders, issues, failedRowNumbers };
}
