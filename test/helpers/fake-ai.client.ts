import {
  AiClientError,
  type AiClient,
  type AiGenerateRequest,
  type AiGenerateResult,
} from '../../src/modules/ai/ai-client';
import type { ExplanationContent } from '../../src/modules/ai/explanation.schema';

/** A valid explanation whose every number exists in the §9.4 test evidence. */
export const VALID_EXPLANATION: ExplanationContent = {
  summary: 'Revenue fell 20% in the current period, from 100.00 to 80.00.',
  observedFacts: ['Revenue dropped 20% (100.00 to 80.00).', 'Order count fell 50% (20 to 10).'],
  associatedSignals: ['Average order value rose 60% (5.00 to 8.00).'],
  possibleExplanations: ['A possible explanation is that customers bought fewer, larger orders.'],
  investigationSteps: ['Compare daily order counts between the two periods.'],
  uncertainty: 'The data does not show why order count changed.',
};

export type FakeStep =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * In-memory `AiClient` (§13: no test calls the real API). Records every request
 * and replays a scripted sequence of texts/errors; the default reply is a
 * valid explanation containing only evidence numbers.
 */
export class FakeAiClient implements AiClient {
  readonly calls: AiGenerateRequest[] = [];

  constructor(private readonly script: FakeStep[] = []) {}

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    this.calls.push(request);
    const step = this.script.shift() ?? {
      kind: 'text' as const,
      text: JSON.stringify(VALID_EXPLANATION),
    };
    if (step.kind === 'error') {
      throw step.error;
    }
    return { text: step.text, model: 'fake-model' };
  }
}

export function fakeExplanationText(overrides: Partial<ExplanationContent>): string {
  return JSON.stringify({ ...VALID_EXPLANATION, ...overrides });
}

export function transientError(): AiClientError {
  return new AiClientError('transient', 'The AI service is temporarily unavailable.');
}
