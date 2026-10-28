import { GoogleGenAI } from '@google/genai';
import {
  AiClientError,
  isRetryableAiError,
  type AiClient,
  type AiErrorKind,
  type AiGenerateRequest,
  type AiGenerateResult,
} from './ai-client';

/**
 * One SDK call. Kept as a function so unit tests can drive the retry loop
 * without any network (§13: no test calls the real API).
 */
export type GeminiCall = (params: {
  model: string;
  contents: string;
  config: {
    systemInstruction: string;
    responseMimeType: string;
    responseJsonSchema: Record<string, unknown>;
    temperature: number;
  };
}) => Promise<{ text?: string }>;

export interface GeminiClientOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Per-attempt deadline (§10: timeouts retry with backoff). */
  readonly timeoutMs?: number;
  /** Total attempts including the first one; max 3 on transient errors. */
  readonly maxAttempts?: number;
  /** First backoff step; doubles each retry. */
  readonly baseDelayMs?: number;
  readonly call?: GeminiCall;
  /** Injectable so tests observe backoff without waiting. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const MAX_MESSAGE_LENGTH = 300;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One SDK client per process; constructing it performs no network I/O. */
function createSdkCall(apiKey: string): GeminiCall {
  const ai = new GoogleGenAI({ apiKey });
  return (params) => ai.models.generateContent(params);
}

/** Raw error shape shared by the SDK's ApiError and Node network failures. */
function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === 'number') {
    return candidate.status;
  }
  return typeof candidate.code === 'number' ? candidate.code : undefined;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return typeof error === 'string' ? error : 'unknown error';
}

/**
 * Maps provider and transport failures onto the six kinds the processor
 * understands. Anything unrecognized becomes `unknown` (non-retryable), so an
 * unexpected failure surfaces as a safe FAILED explanation instead of looping.
 */
export function classifyAiError(error: unknown): AiErrorKind {
  const status = readStatus(error);
  if (status !== undefined) {
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'auth';
    if (status === 408) return 'timeout';
    if (status === 400 || status === 404 || status === 422) return 'invalid_request';
    if (status >= 500) return 'transient';
  }

  const message = readMessage(error).toLowerCase();
  if (
    message.includes('api key not valid') ||
    message.includes('api_key_invalid') ||
    message.includes('unauthenticated')
  ) {
    return 'auth';
  }
  if (message.includes('deadline exceeded') || message.includes('timed out')) {
    return 'timeout';
  }
  if (
    message.includes('resource exhausted') ||
    message.includes('too many requests') ||
    message.includes('quota')
  ) {
    return 'rate_limited';
  }
  if (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('eai_again') ||
    message.includes('socket hang up') ||
    message.includes('network')
  ) {
    return 'transient';
  }
  if (
    message.includes('invalid_argument') ||
    message.includes('invalid argument') ||
    message.includes('not found')
  ) {
    return 'invalid_request';
  }
  return 'unknown';
}

/**
 * Gemini implementation of `AiClient` (T5.3, §10).
 *
 * - structured JSON output is requested via `responseJsonSchema`;
 * - each attempt has a deadline; timeouts, rate limits and transient failures
 *   retry with exponential backoff, up to `maxAttempts`;
 * - errors are classified into `AiErrorKind` and their text is scrubbed of the
 *   API key, so nothing secret can reach a log or an error response.
 */
export class GeminiClient implements AiClient {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly call: GeminiCall;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly apiKey: string;

  constructor(options: GeminiClientOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.call = options.call ?? createSdkCall(options.apiKey);
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    let lastError: AiClientError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.withTimeout(
          this.call({
            model: this.model,
            contents: request.prompt,
            config: {
              systemInstruction: request.systemInstruction,
              responseMimeType: 'application/json',
              responseJsonSchema: request.responseJsonSchema,
              temperature: 0.2,
            },
          }),
        );

        const text = response.text;
        if (typeof text !== 'string' || text.trim().length === 0) {
          // Empty usually means a blocked or truncated reply; worth one retry.
          throw new AiClientError('transient', 'The model returned an empty response.');
        }
        return { text, model: this.model };
      } catch (error) {
        lastError = this.toAiError(error);
        if (!isRetryableAiError(lastError.kind) || attempt === this.maxAttempts) {
          throw lastError;
        }
        await this.sleep(this.backoffDelayMs(attempt));
      }
    }

    throw lastError ?? new AiClientError('unknown', 'The AI request failed.');
  }

  /** Backoff: base, 2x, 4x, ... capped so a stuck worker recovers quickly. */
  backoffDelayMs(attempt: number): number {
    return this.baseDelayMs * 2 ** (attempt - 1);
  }

  private async withTimeout<T>(pending: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new AiClientError('timeout', `No response within ${this.timeoutMs} ms.`));
        }
      }, this.timeoutMs);

      // Handlers stay attached after the timeout fires, so a late rejection is
      // still consumed instead of becoming an unhandled rejection.
      pending.then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        },
      );
    });
  }

  private toAiError(error: unknown): AiClientError {
    if (error instanceof AiClientError) {
      return error;
    }
    return new AiClientError(classifyAiError(error), this.redact(readMessage(error)));
  }

  /** Strips the key (in any shape) and bounds the message length. */
  private redact(message: string): string {
    let safe = message;
    if (this.apiKey.length > 0) {
      safe = safe.split(this.apiKey).join('[redacted]');
    }
    return safe.length > MAX_MESSAGE_LENGTH ? `${safe.slice(0, MAX_MESSAGE_LENGTH)}…` : safe;
  }
}
