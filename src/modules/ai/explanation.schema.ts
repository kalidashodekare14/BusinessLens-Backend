import { z } from 'zod';

/**
 * Structured shape of an explanation (TASKS.md T5.4, §10).
 *
 * The model is asked for JSON matching `EXPLANATION_JSON_SCHEMA`; the returned
 * text is parsed with this schema. Anything that does not match — missing
 * sections, empty lists, nested junk — is rejected before it can reach a user,
 * retried once, and otherwise stored as a FAILED explanation.
 */
// strictObject: unknown top-level keys are a schema violation, matching the
// `additionalProperties: false` we request from the model.
export const explanationContentSchema = z.strictObject({
  summary: z.string().min(1).max(4000),
  observedFacts: z.array(z.string().min(1).max(2000)).min(1).max(20),
  associatedSignals: z.array(z.string().min(1).max(2000)).min(1).max(20),
  possibleExplanations: z.array(z.string().min(1).max(2000)).min(1).max(20),
  investigationSteps: z.array(z.string().min(1).max(2000)).min(1).max(20),
  uncertainty: z.string().min(1).max(4000),
});

export type ExplanationContent = z.infer<typeof explanationContentSchema>;

export const EXPLANATION_FIELDS = [
  'summary',
  'observedFacts',
  'associatedSignals',
  'possibleExplanations',
  'investigationSteps',
  'uncertainty',
] as const;

/**
 * JSON Schema sent to Gemini via `responseJsonSchema`, mirroring the zod schema
 * above field for field. Kept as plain JSON (no zod conversion) because the SDK
 * forwards it to the API's structured-output support unchanged.
 */
export const EXPLANATION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'One short paragraph: what the finding observed.',
    },
    observedFacts: {
      type: 'array',
      items: { type: 'string' },
      description: 'Statements backed by numbers in the evidence.',
    },
    associatedSignals: {
      type: 'array',
      items: { type: 'string' },
      description: 'Co-occurring metrics from the evidence, not causes.',
    },
    possibleExplanations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Hypotheses clearly marked as unverified.',
    },
    investigationSteps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete next steps to investigate.',
    },
    uncertainty: {
      type: 'string',
      description: 'What is unknown and cannot be concluded.',
    },
  },
  required: [...EXPLANATION_FIELDS],
  additionalProperties: false,
};
