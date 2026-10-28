import { Prisma } from '../../../generated/prisma/client';
import { displayPercent, percentChange } from '../../metrics/change';
import type { OrganizationMetrics } from '../../metrics/metrics.types';
import { countValue, moneyComparison } from './evidence';
import { hasEnoughPreviousOrders } from './guards';
import type { FindingDraft, Rule } from './rule.interface';

export const ORDER_COUNT_DROP_VERSION = 'order-count-drop-v1';
/** Trigger is inclusive: exactly -10% produces a finding. */
export const ORDER_COUNT_DROP_TRIGGER = new Prisma.Decimal(-10);
/** HIGH is strictly below -20%; exactly -20% stays MEDIUM (§9.3 wording). */
export const ORDER_COUNT_DROP_HIGH = new Prisma.Decimal(-20);

function title(change: Prisma.Decimal): string {
  return `Order count dropped ${Math.abs(displayPercent(change)).toFixed(1)}%`;
}

/**
 * Compares the number of non-excluded orders between the two periods. The
 * minimum-volume guard also guarantees the previous count is not zero.
 */
export const orderCountDropRule: Rule = {
  id: 'ORDER_COUNT_DROP',
  version: ORDER_COUNT_DROP_VERSION,

  evaluate(metrics: OrganizationMetrics): FindingDraft[] {
    if (!hasEnoughPreviousOrders(metrics)) {
      return [];
    }

    const change = percentChange(
      new Prisma.Decimal(metrics.current.orderCount),
      new Prisma.Decimal(metrics.previous.orderCount),
    );
    if (change === null || change.greaterThan(ORDER_COUNT_DROP_TRIGGER)) {
      return [];
    }

    return [
      {
        type: 'ORDER_COUNT_DROP',
        severity: change.lessThan(ORDER_COUNT_DROP_HIGH) ? 'HIGH' : 'MEDIUM',
        title: title(change),
        subjectKey: null,
        ruleVersion: ORDER_COUNT_DROP_VERSION,
        evidence: {
          metric: 'orderCount',
          current: countValue(metrics.current.orderCount, metrics.current),
          previous: countValue(metrics.previous.orderCount, metrics.previous),
          changePercent: displayPercent(change),
          thresholds: { trigger: -10, high: -20 },
          relatedMetrics: {
            revenue: moneyComparison(metrics.current.revenue, metrics.previous.revenue),
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
