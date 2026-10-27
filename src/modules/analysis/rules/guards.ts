import type { OrganizationMetrics } from '../../metrics/metrics.types';

/** §9.3: no finding when the previous period has fewer than 20 orders. */
export const MIN_PREVIOUS_ORDERS = 20;

export function hasEnoughPreviousOrders(metrics: OrganizationMetrics): boolean {
  return metrics.previous.orderCount >= MIN_PREVIOUS_ORDERS;
}
