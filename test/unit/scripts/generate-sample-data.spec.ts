import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildSampleData,
  checkSampleData,
  ORDERS_HEADER,
  percentChange,
  PRODUCTS_HEADER,
  SAMPLE_DAYS,
  SAMPLE_REFERENCE_DATE,
  toOrdersCsv,
  toProductsCsv,
  writeSampleFiles,
} from '../../../scripts/generate-sample-data';
import { validateMapping } from '../../../src/modules/imports/csv/mapping';
import { createRowMapper } from '../../../src/modules/imports/csv/row-mapper';
import {
  validateOrderRow,
  validateProductRow,
} from '../../../src/modules/imports/csv/row-validator';

const ORDER_MAPPING = {
  orderId: 'Order ID',
  orderedAt: 'Order Date',
  status: 'Status',
  productName: 'Product',
  sku: 'SKU',
  quantity: 'Qty',
  unitPrice: 'Unit Price',
};

const PRODUCT_MAPPING = { name: 'Name', sku: 'SKU', price: 'Price' };

function dataRows(csv: string): string[][] {
  return csv
    .trimEnd()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','));
}

describe('sample data generator', () => {
  it('is deterministic for the same seed', () => {
    const first = buildSampleData();
    const second = buildSampleData();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('spans five months and ends on the reference date', () => {
    const { orders } = buildSampleData();
    const timestamps = orders.map((order) => order.orderedAt.getTime());
    const firstDay = new Date(SAMPLE_REFERENCE_DATE.getTime() - (SAMPLE_DAYS - 1) * 86_400_000);
    const lastDay = new Date(SAMPLE_REFERENCE_DATE.getTime() + 86_400_000 - 1);

    expect(new Date(Math.min(...timestamps)).toISOString().slice(0, 10)).toBe(
      firstDay.toISOString().slice(0, 10),
    );
    expect(new Date(Math.max(...timestamps)).toISOString().slice(0, 10)).toBe(
      SAMPLE_REFERENCE_DATE.toISOString().slice(0, 10),
    );
    expect(new Date(Math.max(...timestamps)).getTime()).toBeLessThanOrEqual(lastDay.getTime());
  });

  it('triggers all three analysis rules', () => {
    const { orders } = buildSampleData();
    const check = checkSampleData(orders);

    expect(check.referenceDate.toISOString()).toBe(SAMPLE_REFERENCE_DATE.toISOString());
    expect(check.previous.orderCount).toBeGreaterThanOrEqual(20);
    expect(check.revenueChangePercent).toBeLessThanOrEqual(-10);
    expect(check.orderCountChangePercent).toBeLessThanOrEqual(-10);
    expect(check.sharpestProductDrop.name).toBe('Burr Grinder');
    expect(check.sharpestProductDrop.changePercent).toBeLessThanOrEqual(-30);
  });

  it('writes one valid ORDERS row per line item', () => {
    const { orders } = buildSampleData();
    const csv = toOrdersCsv(orders);
    const rows = dataRows(csv);
    const itemCount = orders.reduce((sum, order) => sum + order.items.length, 0);

    expect(csv.startsWith(`${ORDERS_HEADER}\n`)).toBe(true);
    expect(rows).toHaveLength(itemCount);
    for (const row of rows) {
      expect(row).toHaveLength(7);
      expect(row[6]).toMatch(/^\d+\.\d{2}$/);
      expect(row[5]).toMatch(/^[1-3]$/);
    }
    expect(rows.some((row) => row[2] === 'cancelled')).toBe(true);
    expect(rows.some((row) => row[2] === 'refunded')).toBe(true);
  });

  it('produces rows the importer validator accepts', () => {
    const { products, orders } = buildSampleData();

    const orderHeaders = ORDERS_HEADER.split(',');
    const orderMapping = validateMapping('ORDERS', orderHeaders, ORDER_MAPPING);
    expect(orderMapping.valid).toBe(true);
    if (!orderMapping.valid) {
      return;
    }
    const mapOrderRow = createRowMapper('ORDERS', orderHeaders, orderMapping.mapping);
    for (const row of dataRows(toOrdersCsv(orders))) {
      const result = validateOrderRow(mapOrderRow(row));
      if (!result.valid) {
        throw new Error(
          `Invalid generated order row ${row.join(',')}: ${JSON.stringify(result.errors)}`,
        );
      }
    }

    const productHeaders = PRODUCTS_HEADER.split(',');
    const productMapping = validateMapping('PRODUCTS', productHeaders, PRODUCT_MAPPING);
    expect(productMapping.valid).toBe(true);
    if (!productMapping.valid) {
      return;
    }
    const mapProductRow = createRowMapper('PRODUCTS', productHeaders, productMapping.mapping);
    for (const row of dataRows(toProductsCsv(products))) {
      const result = validateProductRow(mapProductRow(row));
      if (!result.valid) {
        throw new Error(
          `Invalid generated product row ${row.join(',')}: ${JSON.stringify(result.errors)}`,
        );
      }
    }
  });

  it('writes both CSV files to the requested directory', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bl-sample-'));
    try {
      const { ordersPath, productsPath, check } = await writeSampleFiles(outputDir);

      expect(await readFile(ordersPath, 'utf8')).toBe(toOrdersCsv(buildSampleData().orders));
      expect(await readFile(productsPath, 'utf8')).toBe(toProductsCsv(buildSampleData().products));
      expect(check.sharpestProductDrop.changePercent).toBeLessThanOrEqual(-30);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('treats a zero previous value as no change', () => {
    expect(percentChange(100, 0)).toBe(0);
    expect(percentChange(50, 100)).toBe(-50);
  });
});
