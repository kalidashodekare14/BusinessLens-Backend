import { ANALYSIS_RULES, runRules } from '../../../../src/modules/analysis/rules/rule.registry';
import { buildMetrics, product } from './metrics-fixture';

describe('analysis rule registry', () => {
  it('registers the three MVP rules in a stable order', () => {
    expect(ANALYSIS_RULES.map((rule) => rule.id)).toEqual([
      'REVENUE_DROP',
      'ORDER_COUNT_DROP',
      'PRODUCT_REVENUE_DROP',
    ]);
    expect(ANALYSIS_RULES.map((rule) => rule.version)).toEqual([
      'revenue-drop-v1',
      'order-count-drop-v1',
      'product-revenue-drop-v1',
    ]);
  });

  it('collects findings from every rule deterministically', () => {
    const drafts = runRules(
      buildMetrics({
        previous: {
          orderCount: 25,
          revenue: '1000',
          products: [product('Widget', '100')],
        },
        current: {
          orderCount: 10,
          revenue: '400',
          products: [product('Widget', '10')],
        },
      }),
    );

    expect(drafts.map((draft) => draft.type)).toEqual([
      'REVENUE_DROP',
      'ORDER_COUNT_DROP',
      'PRODUCT_REVENUE_DROP',
    ]);
    expect(drafts.every((draft) => draft.severity === 'HIGH')).toBe(true);
  });

  it('returns no findings when the guards or thresholds are not met', () => {
    const drafts = runRules(
      buildMetrics({
        previous: { orderCount: 19, revenue: '1000' },
        current: { orderCount: 19, revenue: '1000' },
      }),
    );

    expect(drafts).toEqual([]);
  });
});
