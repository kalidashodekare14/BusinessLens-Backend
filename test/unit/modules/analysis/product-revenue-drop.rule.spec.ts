import { productRevenueDropRule } from '../../../../src/modules/analysis/rules/product-revenue-drop.rule';
import { buildMetrics, product } from './metrics-fixture';

function evaluateProductChange(previousRevenue: string, currentRevenue: string) {
  return productRevenueDropRule.evaluate(
    buildMetrics({
      previous: {
        orderCount: 25,
        revenue: '500',
        products: [product('Widget', previousRevenue)],
      },
      current: {
        revenue: '300',
        products: [product('Widget', currentRevenue)],
      },
    }),
  );
}

describe('PRODUCT_REVENUE_DROP rule', () => {
  it('does nothing when the previous period has fewer than 20 orders', () => {
    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: {
          orderCount: 19,
          products: [product('Widget', '100')],
        },
        current: { products: [product('Widget', '1')] },
      }),
    );

    expect(drafts).toEqual([]);
  });

  it('triggers exactly at -30% with MEDIUM severity', () => {
    const drafts = evaluateProductChange('100', '70');

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      type: 'PRODUCT_REVENUE_DROP',
      severity: 'MEDIUM',
      title: 'Widget revenue dropped 30.0%',
      subjectKey: 'id-Widget',
      ruleVersion: 'product-revenue-drop-v1',
    });
    expect(drafts[0].evidence.changePercent).toBe(-30);
  });

  it('does not trigger just inside the threshold', () => {
    expect(evaluateProductChange('100', '70.01')).toEqual([]);
  });

  it('keeps -50% at MEDIUM and escalates below it to HIGH', () => {
    expect(evaluateProductChange('100', '50')[0].severity).toBe('MEDIUM');
    expect(evaluateProductChange('100', '49.99')[0].severity).toBe('HIGH');
    expect(evaluateProductChange('100', '49.99')[0].evidence.changePercent).toBe(-50);
  });

  it('treats a product that disappears from the current period as -100%', () => {
    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: { orderCount: 25, products: [product('Widget', '100')] },
        current: { products: [] },
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0].severity).toBe('HIGH');
    expect(drafts[0].evidence.current.value).toBe('0.00');
    expect(drafts[0].evidence.changePercent).toBe(-100);
  });

  it('skips a product whose previous revenue is zero', () => {
    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: {
          orderCount: 25,
          products: [product('Freebie', '0'), product('Widget', '100')],
        },
        current: { products: [product('Freebie', '0'), product('Widget', '10')] },
      }),
    );

    expect(drafts.map((draft) => draft.evidence.product?.name)).toEqual(['Widget']);
  });

  it('considers only the top 10 products by previous revenue', () => {
    const previousProducts = Array.from({ length: 11 }, (_, index) =>
      product(`Product ${index + 1}`, 100 - index * 10),
    );

    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: { orderCount: 25, products: previousProducts },
        current: { products: [] },
      }),
    );

    expect(drafts).toHaveLength(10);
    expect(drafts.map((draft) => draft.evidence.product?.name)).toEqual(
      previousProducts.slice(0, 10).map((item) => item.name),
    );
    expect(drafts.some((draft) => draft.evidence.product?.name === 'Product 11')).toBe(false);
  });

  it('orders equal-revenue products deterministically by name', () => {
    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: {
          orderCount: 25,
          products: [product('Beta', '100'), product('Alpha', '100')],
        },
        current: { products: [] },
      }),
    );

    expect(drafts.map((draft) => draft.evidence.product?.name)).toEqual(['Alpha', 'Beta']);
  });

  it('matches a renamed product by id instead of name', () => {
    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: {
          orderCount: 25,
          products: [product('Old name', '100', { productId: 'product-1' })],
        },
        current: {
          products: [product('New name', '10', { productId: 'product-1' })],
        },
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0].subjectKey).toBe('product-1');
    expect(drafts[0].evidence.product).toEqual({ id: 'product-1', name: 'Old name' });
    expect(drafts[0].evidence.changePercent).toBe(-90);
  });

  it('falls back to the product name when there is no product id', () => {
    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: {
          orderCount: 25,
          products: [product('Widget', '100', { productId: null })],
        },
        current: {
          products: [product('Widget', '70', { productId: null })],
        },
      }),
    );

    expect(drafts[0].subjectKey).toBe('Widget');
  });

  it('writes product evidence with money strings and related metrics', () => {
    const drafts = productRevenueDropRule.evaluate(
      buildMetrics({
        previous: {
          orderCount: 25,
          revenue: '500',
          products: [product('Widget', '100', { productId: 'product-1', units: 10 })],
        },
        current: {
          revenue: '300',
          products: [product('Widget', '40', { productId: 'product-1', units: 4 })],
        },
      }),
    );

    expect(drafts[0].evidence).toEqual({
      metric: 'productRevenue',
      product: { id: 'product-1', name: 'Widget' },
      current: {
        value: '40.00',
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-30T00:00:00.000Z',
      },
      previous: {
        value: '100.00',
        start: '2026-08-02T00:00:00.000Z',
        end: '2026-08-31T00:00:00.000Z',
      },
      changePercent: -60,
      thresholds: { trigger: -30, high: -50 },
      relatedMetrics: {
        productUnits: { current: 4, previous: 10, changePercent: -60 },
        overallRevenue: {
          current: '300.00',
          previous: '500.00',
          changePercent: -40,
        },
      },
    });
  });

  it('does not trigger for a product whose revenue grows', () => {
    expect(evaluateProductChange('100', '140')).toEqual([]);
  });
});
