import type { FindingType, Severity } from '../../generated/prisma/client';
import type { AiGenerateRequest } from './ai-client';
import { EXPLANATION_JSON_SCHEMA } from './explanation.schema';

/**
 * The fixed system prompt (TASKS.md T5.4, §10). It pins the five sections, the
 * separation of observed fact from hypothesis, and the rule that the AI
 * explains but never decides or states a cause as fact (§2 principle 3).
 */
export const EXPLANATION_SYSTEM_PROMPT = `You explain e-commerce findings for small business owners.

You receive a finding: its type, severity, title and evidence. The evidence is the ONLY source of numbers. Never calculate, never infer, never invent a number. If a number is not in the evidence, do not mention it.

Rules:
- Plain English, concise, no marketing tone, no jargon.
- Separate clearly: observed facts (from the evidence), associated signals (co-occurring metrics, not causes), possible explanations (hypotheses, explicitly not conclusions), investigation steps, and uncertainty.
- Never state a cause as a fact. The MVP cannot verify causes, so present them as possibilities only.
- Never recommend or promise actions beyond investigating.
- Answer ONLY with JSON matching the required schema. No prose, no markdown, no code fences.

Sections:
- summary: one short paragraph describing what was observed.
- observedFacts: statements that use only numbers present in the evidence.
- associatedSignals: related metrics from the evidence that move together.
- possibleExplanations: hypotheses, each phrased as a possibility.
- investigationSteps: concrete steps to test those hypotheses.
- uncertainty: what is unknown and cannot be concluded from this data.`;

/** Only these four fields ever reach the model (§10: no raw rows, no customer data). */
export interface ExplanationPromptInput {
  readonly type: FindingType;
  readonly severity: Severity;
  readonly title: string;
  readonly evidence: unknown;
}

export function buildExplanationRequest(input: ExplanationPromptInput): AiGenerateRequest {
  return {
    systemInstruction: EXPLANATION_SYSTEM_PROMPT,
    // Serialized exactly as §10 describes: type, severity, title, evidence.
    prompt: JSON.stringify({
      type: input.type,
      severity: input.severity,
      title: input.title,
      evidence: input.evidence,
    }),
    responseJsonSchema: EXPLANATION_JSON_SCHEMA,
  };
}
