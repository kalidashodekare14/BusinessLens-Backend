import {
  EXPLANATION_SYSTEM_PROMPT,
  buildExplanationRequest,
} from '../../../../src/modules/ai/prompt.builder';
import {
  EXPLANATION_JSON_SCHEMA,
  EXPLANATION_FIELDS,
  explanationContentSchema,
} from '../../../../src/modules/ai/explanation.schema';
import { VALID_EXPLANATION } from '../../../helpers/fake-ai.client';

describe('explanation prompt builder (§10)', () => {
  const evidence = {
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

  it('sends only type, severity, title and evidence', () => {
    const request = buildExplanationRequest({
      type: 'REVENUE_DROP',
      severity: 'HIGH',
      title: 'Revenue dropped 20.0%',
      evidence,
    });

    const payload = JSON.parse(request.prompt) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['evidence', 'severity', 'title', 'type']);
    expect(payload.type).toBe('REVENUE_DROP');
    expect(payload.severity).toBe('HIGH');
    expect(payload.evidence).toEqual(evidence);

    // Nothing tenant-specific or row-level may reach the model.
    expect(request.prompt).not.toContain('organizationId');
    expect(request.prompt).not.toContain('userId');
    expect(request.prompt).not.toContain('customer');
    expect(request.systemInstruction).not.toContain('organizationId');
  });

  it('carries the section, number and causality rules in the system prompt', () => {
    expect(EXPLANATION_SYSTEM_PROMPT).toContain('ONLY source of numbers');
    expect(EXPLANATION_SYSTEM_PROMPT).toContain('never infer');
    expect(EXPLANATION_SYSTEM_PROMPT).toContain('hypotheses');
    expect(EXPLANATION_SYSTEM_PROMPT).toContain('uncertainty');
    expect(EXPLANATION_SYSTEM_PROMPT).toContain('JSON');
  });

  it('requests a structured response matching the zod schema fields', () => {
    const request = buildExplanationRequest({
      type: 'REVENUE_DROP',
      severity: 'MEDIUM',
      title: 't',
      evidence: {},
    });

    expect(request.responseJsonSchema).toEqual(EXPLANATION_JSON_SCHEMA);
    expect(EXPLANATION_JSON_SCHEMA.required).toEqual([...EXPLANATION_FIELDS]);
    expect(EXPLANATION_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('explanation zod schema (§10)', () => {
  it('accepts a complete explanation', () => {
    expect(explanationContentSchema.safeParse(VALID_EXPLANATION).success).toBe(true);
  });

  it('rejects missing, empty and mistyped sections', () => {
    const withoutSummary: Record<string, unknown> = { ...VALID_EXPLANATION };
    delete withoutSummary.summary;
    expect(explanationContentSchema.safeParse(withoutSummary).success).toBe(false);

    expect(explanationContentSchema.safeParse({ ...VALID_EXPLANATION, summary: '' }).success).toBe(
      false,
    );
    expect(
      explanationContentSchema.safeParse({ ...VALID_EXPLANATION, observedFacts: [] }).success,
    ).toBe(false);
    expect(
      explanationContentSchema.safeParse({ ...VALID_EXPLANATION, observedFacts: 'not a list' })
        .success,
    ).toBe(false);
    expect(
      explanationContentSchema.safeParse({ ...VALID_EXPLANATION, uncertainty: { text: 'x' } })
        .success,
    ).toBe(false);
    expect(
      explanationContentSchema.safeParse({ ...VALID_EXPLANATION, extraField: 'nope' }).success,
    ).toBe(false);
  });
});
