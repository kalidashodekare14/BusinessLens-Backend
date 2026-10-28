/**
 * Provider-neutral contract for the AI behind explanations (§10).
 *
 * The worker depends only on this interface, so tests substitute a fake and
 * never call the real API (§13). Everything here is passed in plain data: the
 * API key lives inside the implementation and never appears in a request,
 * an error message or a log.
 */
export interface AiGenerateRequest {
  /** System instruction: the fixed section and tone rules from §10. */
  readonly systemInstruction: string;
  /** User content: type, severity, title and evidence as JSON (§10 input). */
  readonly prompt: string;
  /** JSON Schema the response text must conform to. */
  readonly responseJsonSchema: Record<string, unknown>;
}

export interface AiGenerateResult {
  /** Raw response text; the caller parses and validates it. */
  readonly text: string;
  /** The model that produced the text (stored on the explanation). */
  readonly model: string;
}

/**
 * Failures classified once, at the client boundary, so the processor can decide
 * what to retry without inspecting provider-specific errors.
 */
export type AiErrorKind =
  'timeout' | 'rate_limited' | 'auth' | 'invalid_request' | 'transient' | 'unknown';

export class AiClientError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

/** Only these are worth retrying with backoff; auth and bad requests are not. */
export function isRetryableAiError(kind: AiErrorKind): boolean {
  return kind === 'timeout' || kind === 'rate_limited' || kind === 'transient';
}

/** Safe, human-readable reason for a failed generation, keyed by kind. */
export function safeAiErrorMessage(kind: AiErrorKind): string {
  switch (kind) {
    case 'timeout':
      return 'The AI service did not respond in time.';
    case 'rate_limited':
      return 'The AI service is rate limiting requests.';
    case 'auth':
      return 'The AI service rejected the credentials.';
    case 'invalid_request':
      return 'The AI service could not use the request.';
    case 'transient':
      return 'The AI service is temporarily unavailable.';
    default:
      return 'The AI service failed unexpectedly.';
  }
}

/** DI token so the worker can swap in a fake without touching this file. */
export const AI_CLIENT = 'AI_CLIENT';

export interface AiClient {
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}
