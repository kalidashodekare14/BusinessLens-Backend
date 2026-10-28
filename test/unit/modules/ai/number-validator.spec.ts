import type { ExplanationContent } from '../../../../src/modules/ai/explanation.schema';
import { validateExplanationNumbers } from '../../../../src/modules/ai/number-validator';

const EVIDENCE = {
  metric: 'revenue',
  current: { value: '80.00', start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' },
  previous: {
    value: '100.00',
    start: '2026-08-02T00:00:00.000Z',
    end: '2026-08-31T00:00:00.000Z',
  },
  changePercent: -20,
  thresholds: { trigger: -10, high: -20 },
  relatedMetrics: {
    orderCount: { current: 10, previous: 20, changePercent: -50 },
    averageOrderValue: { current: '8.00', previous: '5.00', changePercent: 60 },
  },
};

const TITLE = 'Revenue dropped 20.0%';

/** Number-free content so only the summary under test contributes numbers. */
function contentWith(summary: string): ExplanationContent {
  return {
    summary,
    observedFacts: ['no digits in this line'],
    associatedSignals: ['no digits in this line'],
    possibleExplanations: ['a hypothesis without numbers'],
    investigationSteps: ['look into it without numbers'],
    uncertainty: 'nothing numeric is known',
  };
}

function check(
  summary: string,
  evidence: unknown = EVIDENCE,
  title: string = TITLE,
): ReturnType<typeof validateExplanationNumbers> {
  return validateExplanationNumbers(contentWith(summary), evidence, title);
}

describe('number validator (§10)', () => {
  it('accepts numbers that are present in the evidence', () => {
    expect(check('Revenue fell from 100.00 to 80.00 in the current period.').valid).toBe(true);
    expect(check('The order count went from 20 to 10 orders.').valid).toBe(true);
    expect(check('The threshold is -10 and the high severity point is -20.').valid).toBe(true);
    expect(check('Average order value moved from 5.00 to 8.00.').valid).toBe(true);
  });

  it('rejects an invented number and names it', () => {
    const result = check('Revenue was 555.00 in the current period.');

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([{ field: 'summary', token: '555.00' }]);
  });

  it('rejects a number that belongs to another finding', () => {
    const otherFindingEvidence = {
      metric: 'product_revenue',
      current: { value: '750.00' },
      previous: { value: '1100.00' },
      changePercent: -31.8,
    };

    // 750.00 exists, but on a different finding: against this evidence it is invented.
    const result = check('The product earned 750.00 this period.');
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([{ field: 'summary', token: '750.00' }]);

    // The same sentence is fine for the finding that owns 750.00.
    expect(check('The product earned 750.00 this period.', otherFindingEvidence).valid).toBe(true);
  });

  it('accepts rounded numbers within the written precision', () => {
    // Exact change is -19.999999999... but the display rounds to -20.0%.
    const evidence = { ...EVIDENCE, changePercent: -19.999999999 };
    expect(check('Revenue dropped 20.0%.', evidence).valid).toBe(true);
    expect(check('Revenue dropped 19.999999999%.', evidence).valid).toBe(true);

    // 1999.99 rounded up is fine, but claiming two decimals it does not have is not.
    const money = { metric: 'revenue', current: { value: '1999.99' } };
    expect(check('Revenue reached 2,000.', money).valid).toBe(true);
    expect(check('Revenue reached 2,000.0.', money).valid).toBe(true);
    const wrongPrecision = check('Revenue reached 2,000.00.', money);
    expect(wrongPrecision.valid).toBe(false);
    expect(wrongPrecision.issues[0].token).toBe('2,000.00');
  });

  it('accepts percent and ratio forms of the same change', () => {
    expect(check('Revenue dropped 20%.').valid).toBe(true);
    expect(check('Revenue dropped 20 percent.').valid).toBe(true);
    expect(check('The change was -20%.').valid).toBe(true);
    expect(check('Order count fell 50%.').valid).toBe(true);

    // Ratio forms of the evidence percentages: 0.2 = 20% down, 0.8 = 80% of before.
    expect(check('Customers spent 0.2 less often.').valid).toBe(true);
    expect(check('Revenue is 0.8 of the previous period.').valid).toBe(true);

    // Percentages that are not in the evidence stay rejected.
    expect(check('Revenue dropped 35%.').valid).toBe(false);
    expect(check('The ratio was 0.35 of the previous period.').valid).toBe(false);
  });

  it('ignores digits glued inside words', () => {
    expect(check('Track SKU-2x and vitamin12 replacements alongside it.').valid).toBe(true);
    expect(check('Compare version3 builds before concluding.').valid).toBe(true);
  });

  it('handles negative numbers with their sign', () => {
    expect(check('The change was -20 in percentage points.').valid).toBe(true);
    expect(check('A drop of -50 was recorded for order count.').valid).toBe(true);

    // A negative number that no evidence value supports is invented.
    const negative = check('The change was -35 in percentage points.');
    expect(negative.valid).toBe(false);
    expect(negative.issues).toEqual([{ field: 'summary', token: '-35' }]);
  });

  it('accepts currency, thousands separators and evidence dates', () => {
    expect(check('Revenue was $1,234.56 in the window.', { total: '1234.56' }).valid).toBe(true);
    expect(check('Revenue reached $9,999 in the window.').valid).toBe(false);
    expect(check('The current period ends on 2026-09-30.').valid).toBe(true);
    expect(check('The comparison year is 2026.').valid).toBe(true);
    expect(check('The current period ends on 2027-09-30.').valid).toBe(false);
  });

  it('reports the field path of every unsupported number', () => {
    const content: ExplanationContent = {
      summary: 'summary has 777',
      observedFacts: ['first is fine', 'second has 888'],
      associatedSignals: ['no digits here'],
      possibleExplanations: ['no digits here'],
      investigationSteps: ['no digits here'],
      uncertainty: 'no digits here',
    };

    const result = validateExplanationNumbers(content, EVIDENCE, TITLE);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { field: 'summary', token: '777' },
      { field: 'observedFacts[1]', token: '888' },
    ]);
  });

  it('treats numbers repeated from the title as supported', () => {
    const evidence = { metric: 'revenue', changePercent: -18.7 };

    expect(
      check('The 5.5 figure comes from the headline.', evidence, 'Revenue down 5.5%').valid,
    ).toBe(true);
    // Without the title carrying it, 5.5 has no support and is rejected.
    expect(check('The 5.5 figure comes from the headline.', evidence, 'Revenue down').valid).toBe(
      false,
    );
  });
});
