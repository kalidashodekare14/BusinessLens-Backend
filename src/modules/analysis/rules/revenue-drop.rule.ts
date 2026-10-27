import { Prisma } from '../../../generated/prisma/client';
import { displayPercent, percentChange } from '../../metrics/change';
import type { OrganizationMetrics } from '../../metrics/metrics.types';
import { countComparison, moneyComparison, moneyValue } from './evidence';
import { hasEnoughPreviousOrders } from './guards';
import type { FindingDraft, Rule } from './rule.interface';

export const REVENUE_DROP_VERSION = 'revenue-drop-v1';
/** Trigger is inclusive: exactly -10% produces a finding. */
export const REVENUE_DROP_TRIGGER = new Prisma.Decimal(-10);
/** HIGH is strictly below -20%; exactly -20% stays MEDIUM (§9.3 wording). */
export const REVENUE_DROP_HIGH = new Prisma.Decimal(-20);

function title(change: Prisma.Decimal): string {
  return `Revenue dropped ${Math.abs(displayPercent(change)).toFixed(1)}%`;
}

/**
 * Compares total revenue between the two 30-day periods. Guards (§9.3):
 * fewer than 20 previous orders, or previous revenue of zero.
 */
export const revenueDropRule: Rule = {
  id: 'REVENUE_DROP',
  version: REVENUE_DROP_VERSION,

  evaluate(metrics: OrganizationMetrics): FindingDraft[] {
    if (!hasEnoughPreviousOrders(metrics)) {
      return [];
    }

    const change = percentChange(metrics.current.revenue, metrics.previous.revenue);
    if (change === null || change.greaterThan(REVENUE_DROP_TRIGGER)) {
      return [];
    }

    return [
      {
        type: 'REVENUE_DROP',
        severity: change.lessThan(REVENUE_DROP_HIGH) ? 'HIGH' : 'MEDIUM',
        title: title(change),
        subjectKey: null,
        ruleVersion: REVENUE_DROP_VERSION,
        evidence: {
          metric: 'revenue',
          current: moneyValue(metrics.current.revenue, metrics.current),
          previous: moneyValue(metrics.previous.revenue, metrics.previous),
          changePercent: displayPercent(change),
          thresholds: { trigger: -10, high: -20 },
          relatedMetrics: {
            orderCount: countComparison(metrics.current.orderCount, metrics.previous.orderCount),
            averageOrderValue: moneyComparison(
              metrics.current.averageOrderValue,
              metrics.previous.averageOrderValue,
            ),
          },
        },
      },
    ];
  },
};
