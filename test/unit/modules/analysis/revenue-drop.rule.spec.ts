import { revenueDropRule } from '../../../../src/modules/analysis/rules/revenue-drop.rule';
import { buildMetrics } from './metrics-fixture';

describe('REVENUE_DROP rule', () => {
  it('does nothing when the previous period has fewer than 20 orders', () => {
    const metrics = buildMetrics({
      previous: { revenue: '100', orderCount: 19 },
      current: { revenue: '10' },
    });

    expect(revenueDropRule.evaluate(metrics)).toEqual([]);
  });

  it('evaluates when the previous period has exactly 20 orders', () => {
    const metrics = buildMetrics({
      previous: { revenue: '100', orderCount: 20 },
      current: { revenue: '50', orderCount: 20 },
    });

    expect(revenueDropRule.evaluate(metrics)).toHaveLength(1);
  });

  it('does nothing when previous revenue is zero', () => {
    const metrics = buildMetrics({
      previous: { revenue: '0', orderCount: 25 },
      current: { revenue: '0' },
    });

    expect(revenueDropRule.evaluate(metrics)).toEqual([]);
  });

  it('triggers exactly at -10% with MEDIUM severity', () => {
    const drafts = revenueDropRule.evaluate(
      buildMetrics({
        previous: { revenue: '100', orderCount: 25 },
        current: { revenue: '90' },
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      type: 'REVENUE_DROP',
      severity: 'MEDIUM',
      title: 'Revenue dropped 10.0%',
      subjectKey: null,
      ruleVersion: 'revenue-drop-v1',
    });
    expect(drafts[0].evidence.changePercent).toBe(-10);
  });

  it('does not trigger just inside the threshold', () => {
    const drafts = revenueDropRule.evaluate(
      buildMetrics({
        previous: { revenue: '100' },
        current: { revenue: '90.01' },
      }),
    );

    expect(drafts).toEqual([]);
  });

  it('keeps exactly -20% at MEDIUM', () => {
    const drafts = revenueDropRule.evaluate(
      buildMetrics({
        previous: { revenue: '100' },
        current: { revenue: '80' },
      }),
    );

    expect(drafts[0].severity).toBe('MEDIUM');
    expect(drafts[0].evidence.changePercent).toBe(-20);
  });

  it('escalates below -20% to HIGH', () => {
    const drafts = revenueDropRule.evaluate(
      buildMetrics({
        previous: { revenue: '100' },
        current: { revenue: '79.99' },
      }),
    );

    expect(drafts[0].severity).toBe('HIGH');
    expect(drafts[0].evidence.changePercent).toBe(-20);
  });

  it('uses the exact change for severity even when the display value rounds', () => {
    // -19.96% displays as -20.0 but is still above the HIGH threshold.
    const drafts = revenueDropRule.evaluate(
      buildMetrics({
        previous: { revenue: '100' },
        current: { revenue: '80.04' },
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0].severity).toBe('MEDIUM');
    expect(drafts[0].evidence.changePercent).toBe(-20);
    expect(drafts[0].title).toBe('Revenue dropped 20.0%');
  });

  it('writes evidence with money strings, period dates and related metrics', () => {
    const drafts = revenueDropRule.evaluate(
      buildMetrics({
        previous: {
          revenue: '39489.50',
          orderCount: 281,
          averageOrderValue: '140.53',
        },
        current: {
          revenue: '26705.50',
          orderCount: 201,
          averageOrderValue: '132.86',
        },
      }),
    );

    expect(drafts[0].evidence).toEqual({
      metric: 'revenue',
      current: {
        value: '26705.50',
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-30T00:00:00.000Z',
      },
      previous: {
        value: '39489.50',
        start: '2026-08-02T00:00:00.000Z',
        end: '2026-08-31T00:00:00.000Z',
      },
      changePercent: -32.4,
      thresholds: { trigger: -10, high: -20 },
      relatedMetrics: {
        orderCount: { current: 201, previous: 281, changePercent: -28.5 },
        averageOrderValue: {
          current: '132.86',
          previous: '140.53',
          changePercent: -5.5,
        },
      },
    });
  });

  it('does not trigger when revenue grows', () => {
    const drafts = revenueDropRule.evaluate(
      buildMetrics({
        previous: { revenue: '100' },
        current: { revenue: '150' },
      }),
    );

    expect(drafts).toEqual([]);
  });
});
