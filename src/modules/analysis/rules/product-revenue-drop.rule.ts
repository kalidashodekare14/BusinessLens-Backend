import { Prisma } from '../../../generated/prisma/client';
import { displayPercent, percentChange } from '../../metrics/change';
import type { OrganizationMetrics, ProductMetrics } from '../../metrics/metrics.types';
import { countComparison, moneyComparison, moneyValue } from './evidence';
import { hasEnoughPreviousOrders } from './guards';
import type { FindingDraft, Rule } from './rule.interface';

export const PRODUCT_REVENUE_DROP_VERSION = 'product-revenue-drop-v1';
export const PRODUCT_REVENUE_DROP_TOP_N = 10;
/** Trigger is inclusive: exactly -30% produces a finding. */
export const PRODUCT_REVENUE_DROP_TRIGGER = new Prisma.Decimal(-30);
/** HIGH is strictly below -50%; exactly -50% stays MEDIUM (§9.3 wording). */
export const PRODUCT_REVENUE_DROP_HIGH = new Prisma.Decimal(-50);

interface Candidate {
  previous: ProductMetrics;
  current: ProductMetrics | undefined;
}

/** Top 10 products by previous-period revenue, deterministic on ties. */
function rankCandidates(metrics: OrganizationMetrics): Candidate[] {
  const currentById = new Map<string, ProductMetrics>();
  const currentByName = new Map<string, ProductMetrics>();
  for (const product of metrics.current.products) {
    if (product.productId) {
      currentById.set(product.productId, product);
    }
    currentByName.set(product.name, product);
  }

  return metrics.previous.products
    .filter((product) => product.revenue.greaterThan(0))
    .sort((a, b) => {
      const byRevenue = b.revenue.comparedTo(a.revenue);
      if (byRevenue !== 0) {
        return byRevenue;
      }
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) {
        return byName;
      }
      return (a.productId ?? '').localeCompare(b.productId ?? '');
    })
    .slice(0, PRODUCT_REVENUE_DROP_TOP_N)
    .map((previous) => ({
      previous,
      current:
        (previous.productId ? currentById.get(previous.productId) : undefined) ??
        currentByName.get(previous.name),
    }));
}

/**
 * Compares each of the organization's top 10 previous-period products. Products
 * with zero previous revenue are skipped because the percentage is undefined.
 */
export const productRevenueDropRule: Rule = {
  id: 'PRODUCT_REVENUE_DROP',
  version: PRODUCT_REVENUE_DROP_VERSION,

  evaluate(metrics: OrganizationMetrics): FindingDraft[] {
    if (!hasEnoughPreviousOrders(metrics)) {
      return [];
    }

    const drafts: FindingDraft[] = [];

    for (const { previous, current } of rankCandidates(metrics)) {
      const currentRevenue = current?.revenue ?? new Prisma.Decimal(0);
      const change = percentChange(currentRevenue, previous.revenue);
      if (change === null || change.greaterThan(PRODUCT_REVENUE_DROP_TRIGGER)) {
        continue;
      }

      drafts.push({
        type: 'PRODUCT_REVENUE_DROP',
        severity: change.lessThan(PRODUCT_REVENUE_DROP_HIGH) ? 'HIGH' : 'MEDIUM',
        title: `${previous.name} revenue dropped ${Math.abs(displayPercent(change)).toFixed(1)}%`,
        subjectKey: previous.productId ?? previous.name,
        ruleVersion: PRODUCT_REVENUE_DROP_VERSION,
        evidence: {
          metric: 'productRevenue',
          product: { id: previous.productId, name: previous.name },
          current: moneyValue(currentRevenue, metrics.current),
          previous: moneyValue(previous.revenue, metrics.previous),
          changePercent: displayPercent(change),
          thresholds: { trigger: -30, high: -50 },
          relatedMetrics: {
            productUnits: countComparison(current?.units ?? 0, previous.units),
            overallRevenue: moneyComparison(metrics.current.revenue, metrics.previous.revenue),
          },
        },
      });
    }

    return drafts;
  },
};
