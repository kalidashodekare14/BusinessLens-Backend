import { orderCountDropRule } from '../../../../src/modules/analysis/rules/order-count-drop.rule';
import { buildMetrics } from './metrics-fixture';

describe('ORDER_COUNT_DROP rule', () => {
  it('does nothing when the previous period has fewer than 20 orders', () => {
    const metrics = buildMetrics({
      previous: { orderCount: 19 },
      current: { orderCount: 1 },
    });

    expect(orderCountDropRule.evaluate(metrics)).toEqual([]);
  });

  it('triggers exactly at -10% with MEDIUM severity', () => {
    const drafts = orderCountDropRule.evaluate(
      buildMetrics({
        previous: { orderCount: 20 },
        current: { orderCount: 18 },
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      type: 'ORDER_COUNT_DROP',
      severity: 'MEDIUM',
      title: 'Order count dropped 10.0%',
      subjectKey: null,
      ruleVersion: 'order-count-drop-v1',
    });
    expect(drafts[0].evidence.changePercent).toBe(-10);
  });

  it('does not trigger just inside the threshold', () => {
    const drafts = orderCountDropRule.evaluate(
      buildMetrics({
        previous: { orderCount: 20 },
        current: { orderCount: 19 },
      }),
    );

    expect(drafts).toEqual([]);
  });

  it('keeps exactly -20% at MEDIUM', () => {
    const drafts = orderCountDropRule.evaluate(
      buildMetrics({
        previous: { orderCount: 20 },
        current: { orderCount: 16 },
      }),
    );

    expect(drafts[0].severity).toBe('MEDIUM');
    expect(drafts[0].evidence.changePercent).toBe(-20);
  });

  it('escalates below -20% to HIGH', () => {
    const drafts = orderCountDropRule.evaluate(
      buildMetrics({
        previous: { orderCount: 20 },
        current: { orderCount: 15 },
      }),
    );

    expect(drafts[0].severity).toBe('HIGH');
    expect(drafts[0].evidence.changePercent).toBe(-25);
  });

  it('writes count values as numbers and related money as strings', () => {
    const drafts = orderCountDropRule.evaluate(
      buildMetrics({
        previous: {
          orderCount: 281,
          revenue: '39489.50',
          averageOrderValue: '140.53',
        },
        current: {
          orderCount: 201,
          revenue: '26705.50',
          averageOrderValue: '132.86',
        },
      }),
    );

    expect(drafts[0].evidence).toEqual({
      metric: 'orderCount',
      current: {
        value: 201,
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-30T00:00:00.000Z',
      },
      previous: {
        value: 281,
        start: '2026-08-02T00:00:00.000Z',
        end: '2026-08-31T00:00:00.000Z',
      },
      changePercent: -28.5,
      thresholds: { trigger: -10, high: -20 },
      relatedMetrics: {
        revenue: {
          current: '26705.50',
          previous: '39489.50',
          changePercent: -32.4,
        },
        averageOrderValue: {
          current: '132.86',
          previous: '140.53',
          changePercent: -5.5,
        },
      },
    });
  });

  it('does not trigger when order count grows', () => {
    const drafts = orderCountDropRule.evaluate(
      buildMetrics({
        previous: { orderCount: 20 },
        current: { orderCount: 25 },
      }),
    );

    expect(drafts).toEqual([]);
  });
});
