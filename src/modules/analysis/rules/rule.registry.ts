import type { OrganizationMetrics } from '../../metrics/metrics.types';
import { orderCountDropRule } from './order-count-drop.rule';
import { productRevenueDropRule } from './product-revenue-drop.rule';
import { revenueDropRule } from './revenue-drop.rule';
import type { FindingDraft, Rule } from './rule.interface';

/**
 * The complete rule set, in a stable order so a run's findings are deterministic.
 * Adding a rule is an explicit registry change, not filesystem discovery.
 */
export const ANALYSIS_RULES: readonly Rule[] = [
  revenueDropRule,
  orderCountDropRule,
  productRevenueDropRule,
];

export function runRules(metrics: OrganizationMetrics): FindingDraft[] {
  return ANALYSIS_RULES.flatMap((rule) => rule.evaluate(metrics));
}
