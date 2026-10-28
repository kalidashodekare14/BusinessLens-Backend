import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Deterministic demo dataset (TASKS.md T3.9).
 *
 * Five months of orders in which the last 30 days show a revenue drop, an
 * order-count drop, and one product (Burr Grinder) collapsing, so all three
 * analysis rules fire. Everything is generated from a fixed seed, so the files
 * are stable across runs and machines.
 *
 * The data is written as the canonical CSV shapes imported by §8, one row per
 * line item, and every row passes the same validator the importer uses.
 */

export const SAMPLE_SEED = 20261027;
export const SAMPLE_REFERENCE_DATE = new Date('2026-09-30T00:00:00.000Z');
export const SAMPLE_DAYS = 150;
export const CURRENT_PERIOD_DAYS = 30;
export const PREVIOUS_DAILY_ORDERS = 10;
export const CURRENT_DAILY_ORDERS = 7;

export const PRODUCTS_HEADER = 'Name,SKU,Price';
export const ORDERS_HEADER = 'Order ID,Order Date,Status,Product,SKU,Qty,Unit Price';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Mirrors §7; the analysis engine owns the real constant from Phase 4. */
const EXCLUDED_STATUSES = new Set(['cancelled', 'refunded', 'voided']);

export interface SampleProduct {
  name: string;
  sku: string;
  priceCents: number;
}

export interface SampleOrderItem {
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface SampleOrder {
  externalId: string;
  orderedAt: Date;
  status: string;
  items: SampleOrderItem[];
}

export interface SampleDataset {
  products: readonly SampleProduct[];
  orders: readonly SampleOrder[];
}

interface ProductProfile {
  product: SampleProduct;
  /** Share of line items in the baseline months. */
  baseWeight: number;
  /** Share of line items in the last 30 days. */
  currentWeight: number;
}

export const SAMPLE_PRODUCTS: readonly SampleProduct[] = [
  { name: 'Coffee Beans', sku: 'BEAN-1', priceCents: 1200 },
  { name: 'Ceramic Mug', sku: 'MUG-1', priceCents: 950 },
  { name: 'Filter Pack', sku: 'FILT-1', priceCents: 600 },
  { name: 'Milk Frother', sku: 'FROTH-1', priceCents: 3900 },
  { name: 'Burr Grinder', sku: 'GRIND-1', priceCents: 8900 },
  { name: 'Espresso Machine', sku: 'ESP-1', priceCents: 24900 },
];

/**
 * Baseline weights sum to 1. In the current period the grinder drops from 12%
 * to 2% of line items and its share moves to the other products, leaving the
 * average order value roughly unchanged while the grinder's revenue collapses.
 */
const PRODUCT_WEIGHTS: readonly { baseWeight: number; currentWeight: number }[] = [
  { baseWeight: 0.22, currentWeight: 0.25 },
  { baseWeight: 0.22, currentWeight: 0.25 },
  { baseWeight: 0.2, currentWeight: 0.22 },
  { baseWeight: 0.12, currentWeight: 0.14 },
  { baseWeight: 0.12, currentWeight: 0.02 },
  { baseWeight: 0.12, currentWeight: 0.12 },
];

const PROFILES: readonly ProductProfile[] = SAMPLE_PRODUCTS.map((product, index) => ({
  product,
  ...PRODUCT_WEIGHTS[index],
}));

/** Mulberry32: small, fast, and identical on every platform. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(
  candidates: readonly { profile: ProductProfile; weight: number }[],
  random: () => number,
): ProductProfile | null {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total <= 0) {
    return null;
  }

  let target = random() * total;
  for (const candidate of candidates) {
    target -= candidate.weight;
    if (target <= 0) {
      return candidate.profile;
    }
  }
  return candidates.length > 0 ? candidates[candidates.length - 1].profile : null;
}

function quantityFor(random: () => number): number {
  const roll = random();
  if (roll < 0.7) {
    return 1;
  }
  if (roll < 0.95) {
    return 2;
  }
  return 3;
}

function statusFor(random: () => number): string {
  const roll = random();
  if (roll < 0.03) {
    return 'cancelled';
  }
  if (roll < 0.06) {
    return 'refunded';
  }
  return 'completed';
}

export interface BuildSampleDataOptions {
  seed?: number;
  referenceDate?: Date;
  days?: number;
}

/**
 * Builds the dataset in memory. `referenceDate` is the last day of the current
 * 30-day period (UTC midnight); orders are placed on that day at the latest.
 */
export function buildSampleData(options: BuildSampleDataOptions = {}): SampleDataset {
  const seed = options.seed ?? SAMPLE_SEED;
  const referenceDate = options.referenceDate ?? SAMPLE_REFERENCE_DATE;
  const days = options.days ?? SAMPLE_DAYS;
  const random = createRandom(seed);

  const firstDay = new Date(referenceDate.getTime() - (days - 1) * DAY_MS);
  const currentStart = new Date(referenceDate.getTime() - (CURRENT_PERIOD_DAYS - 1) * DAY_MS);

  const orders: SampleOrder[] = [];
  let orderNumber = 1;

  for (let day = 0; day < days; day += 1) {
    const dayStart = new Date(firstDay.getTime() + day * DAY_MS);
    const inCurrentPeriod = dayStart.getTime() >= currentStart.getTime();
    const dailyOrders = inCurrentPeriod ? CURRENT_DAILY_ORDERS : PREVIOUS_DAILY_ORDERS;

    for (let index = 0; index < dailyOrders; index += 1) {
      // Orders land between 09:00 and 18:00 UTC so the date is unambiguous.
      const orderedAt = new Date(
        dayStart.getTime() + (9 * 60 + Math.floor(random() * 9 * 60)) * 60 * 1000,
      );

      const itemCount = 1 + Math.floor(random() * 3);
      const pool = PROFILES.map((profile) => ({
        profile,
        weight: inCurrentPeriod ? profile.currentWeight : profile.baseWeight,
      }));
      const items: SampleOrderItem[] = [];

      for (let slot = 0; slot < itemCount; slot += 1) {
        const picked = pickWeighted(pool, random);
        if (!picked) {
          break;
        }
        items.push({
          productName: picked.product.name,
          sku: picked.product.sku,
          quantity: quantityFor(random),
          unitPriceCents: picked.product.priceCents,
        });
        // One line per product per order; drop the chosen product from the pool.
        pool.splice(
          pool.findIndex((candidate) => candidate.profile === picked),
          1,
        );
      }

      orders.push({
        externalId: `SO-${String(orderNumber).padStart(6, '0')}`,
        orderedAt,
        status: statusFor(random),
        items,
      });
      orderNumber += 1;
    }
  }

  return { products: SAMPLE_PRODUCTS, orders };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toProductsCsv(products: readonly SampleProduct[]): string {
  const rows = products.map((product) =>
    [csvCell(product.name), csvCell(product.sku), formatMoney(product.priceCents)].join(','),
  );
  return [PRODUCTS_HEADER, ...rows].join('\n') + '\n';
}

export function toOrdersCsv(orders: readonly SampleOrder[]): string {
  const rows: string[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      rows.push(
        [
          csvCell(order.externalId),
          formatDate(order.orderedAt),
          csvCell(order.status),
          csvCell(item.productName),
          csvCell(item.sku),
          String(item.quantity),
          formatMoney(item.unitPriceCents),
        ].join(','),
      );
    }
  }
  return [ORDERS_HEADER, ...rows].join('\n') + '\n';
}

export interface PeriodSummary {
  start: Date;
  /** Exclusive. */
  end: Date;
  orderCount: number;
  revenueCents: number;
  productRevenueCents: Record<string, number>;
}

function summarizePeriod(orders: readonly SampleOrder[], start: Date, end: Date): PeriodSummary {
  const summary: PeriodSummary = {
    start,
    end,
    orderCount: 0,
    revenueCents: 0,
    productRevenueCents: {},
  };

  for (const order of orders) {
    if (order.orderedAt < start || order.orderedAt >= end) {
      continue;
    }
    if (EXCLUDED_STATUSES.has(order.status.toLowerCase())) {
      continue;
    }

    summary.orderCount += 1;
    for (const item of order.items) {
      const lineCents = item.unitPriceCents * item.quantity;
      summary.revenueCents += lineCents;
      summary.productRevenueCents[item.productName] =
        (summary.productRevenueCents[item.productName] ?? 0) + lineCents;
    }
  }

  return summary;
}

export function percentChange(current: number, previous: number): number {
  if (previous === 0) {
    return 0;
  }
  return ((current - previous) / previous) * 100;
}

export interface SampleDataCheck {
  referenceDate: Date;
  latestOrderDate: Date;
  current: PeriodSummary;
  previous: PeriodSummary;
  revenueChangePercent: number;
  orderCountChangePercent: number;
  sharpestProductDrop: { name: string; changePercent: number };
}

/**
 * Recomputes the §9 period metrics with the §9 exclusions, so the script fails
 * loudly instead of shipping data that cannot trigger the rules.
 */
export function checkSampleData(orders: readonly SampleOrder[]): SampleDataCheck {
  const latest = orders.reduce(
    (max, order) => (order.orderedAt > max ? order.orderedAt : max),
    new Date(0),
  );
  const referenceDate = new Date(
    Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate()),
  );
  const currentStart = new Date(referenceDate.getTime() - (CURRENT_PERIOD_DAYS - 1) * DAY_MS);
  const previousEnd = currentStart;
  const previousStart = new Date(previousEnd.getTime() - CURRENT_PERIOD_DAYS * DAY_MS);
  const currentEnd = new Date(referenceDate.getTime() + DAY_MS);

  const current = summarizePeriod(orders, currentStart, currentEnd);
  const previous = summarizePeriod(orders, previousStart, previousEnd);

  let sharpestProductDrop = { name: '', changePercent: 0 };
  for (const [name, previousCents] of Object.entries(previous.productRevenueCents)) {
    if (previousCents === 0) {
      continue;
    }
    const change = percentChange(current.productRevenueCents[name] ?? 0, previousCents);
    if (change < sharpestProductDrop.changePercent) {
      sharpestProductDrop = { name, changePercent: change };
    }
  }

  return {
    referenceDate,
    latestOrderDate: latest,
    current,
    previous,
    revenueChangePercent: percentChange(current.revenueCents, previous.revenueCents),
    orderCountChangePercent: percentChange(current.orderCount, previous.orderCount),
    sharpestProductDrop,
  };
}

export async function writeSampleFiles(
  outputDir: string,
  options: BuildSampleDataOptions = {},
): Promise<{ ordersPath: string; productsPath: string; check: SampleDataCheck }> {
  const { products, orders } = buildSampleData(options);
  await mkdir(outputDir, { recursive: true });

  const ordersPath = path.join(outputDir, 'orders.csv');
  const productsPath = path.join(outputDir, 'products.csv');
  await writeFile(productsPath, toProductsCsv(products), 'utf8');
  await writeFile(ordersPath, toOrdersCsv(orders), 'utf8');

  return { ordersPath, productsPath, check: checkSampleData(orders) };
}

function assertRules(check: SampleDataCheck): void {
  if (check.previous.orderCount < 20) {
    throw new Error('The previous period needs at least 20 orders for the rules to run.');
  }
  if (check.revenueChangePercent > -10) {
    throw new Error(`Revenue drop is only ${check.revenueChangePercent.toFixed(1)}%.`);
  }
  if (check.orderCountChangePercent > -10) {
    throw new Error(`Order count drop is only ${check.orderCountChangePercent.toFixed(1)}%.`);
  }
  if (check.sharpestProductDrop.changePercent > -30) {
    throw new Error(
      `No product drops sharply (best: ${check.sharpestProductDrop.name} ${check.sharpestProductDrop.changePercent.toFixed(1)}%).`,
    );
  }
}

async function main(): Promise<void> {
  const { ordersPath, productsPath, check } = await writeSampleFiles('sample-data');
  assertRules(check);

  const formatDay = (date: Date) => date.toISOString().slice(0, 10);
  console.log(`Wrote ${ordersPath} and ${productsPath}`);
  console.log(`Reference date: ${formatDay(check.referenceDate)}`);
  console.log(
    `Current period: ${formatDay(check.current.start)} .. ${formatDay(
      new Date(check.current.end.getTime() - DAY_MS),
    )} — ${check.current.orderCount} orders, $${formatMoney(check.current.revenueCents)}`,
  );
  console.log(
    `Previous period: ${formatDay(check.previous.start)} .. ${formatDay(
      new Date(check.previous.end.getTime() - DAY_MS),
    )} — ${check.previous.orderCount} orders, $${formatMoney(check.previous.revenueCents)}`,
  );
  console.log(`Revenue change: ${check.revenueChangePercent.toFixed(1)}%`);
  console.log(`Order count change: ${check.orderCountChangePercent.toFixed(1)}%`);
  console.log(
    `Sharpest product drop: ${check.sharpestProductDrop.name} ${check.sharpestProductDrop.changePercent.toFixed(1)}%`,
  );
}

// Run only when invoked as `npm run generate:sample-data`; importing this module
// from tests must not write files. `path.resolve` keeps the check cwd-relative,
// and process.argv[1] is the script path for a direct Node invocation.
const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedScript === path.resolve('scripts', 'generate-sample-data.ts')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
