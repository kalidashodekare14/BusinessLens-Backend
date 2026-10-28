import { AiClientError } from '../../../../src/modules/ai/ai-client';
import {
  classifyAiError,
  GeminiClient,
  type GeminiCall,
} from '../../../../src/modules/ai/gemini.client';

const API_KEY = 'super-secret-key-123';

function build(overrides: { call?: GeminiCall; maxAttempts?: number; baseDelayMs?: number } = {}) {
  const sleep = jest.fn().mockResolvedValue(undefined);
  const client = new GeminiClient({
    apiKey: API_KEY,
    model: 'gemini-test',
    timeoutMs: 50,
    maxAttempts: overrides.maxAttempts ?? 3,
    baseDelayMs: overrides.baseDelayMs ?? 100,
    call:
      overrides.call ?? (jest.fn().mockResolvedValue({ text: '{"summary":"ok"}' }) as GeminiCall),
    sleep,
  });
  return { client, sleep };
}

const REQUEST = {
  systemInstruction: 'system',
  prompt: '{"prompt":true}',
  responseJsonSchema: { type: 'object' },
};

describe('GeminiClient', () => {
  it('returns the response text and the configured model', async () => {
    const call = jest.fn().mockResolvedValue({ text: '{"summary":"Revenue fell."}' }) as GeminiCall;
    const { client } = build({ call });

    const result = await client.generate(REQUEST);

    expect(result).toEqual({ text: '{"summary":"Revenue fell."}', model: 'gemini-test' });
    expect(call).toHaveBeenCalledWith({
      model: 'gemini-test',
      contents: REQUEST.prompt,
      config: {
        systemInstruction: 'system',
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
        temperature: 0.2,
      },
    });
  });

  it('retries transient errors with exponential backoff, then succeeds', async () => {
    const call = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { status: 503 }))
      .mockResolvedValue({ text: '{"summary":"ok"}' }) as unknown as GeminiCall;
    const { client, sleep } = build({ call });

    const result = await client.generate(REQUEST);

    expect(result.text).toBe('{"summary":"ok"}');
    expect(call).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]: [number]) => ms)).toEqual([100, 200]);
  });

  it('gives up after maxAttempts and throws the last classified error', async () => {
    const call = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('nope'), { status: 503 }),
      ) as unknown as GeminiCall;
    const { client } = build({ call, maxAttempts: 3 });

    await expect(client.generate(REQUEST)).rejects.toMatchObject({ kind: 'transient' });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('does not retry auth or invalid-request errors', async () => {
    const authCall = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('bad key'), { status: 401 }),
      ) as unknown as GeminiCall;
    const { client } = build({ call: authCall });

    await expect(client.generate(REQUEST)).rejects.toMatchObject({ kind: 'auth' });
    expect(authCall).toHaveBeenCalledTimes(1);

    const badCall = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('bad schema'), { status: 400 }),
      ) as unknown as GeminiCall;
    const { client: badClient } = build({ call: badCall });
    await expect(badClient.generate(REQUEST)).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(badCall).toHaveBeenCalledTimes(1);
  });

  it('treats an empty response as transient and retries it', async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: undefined })
      .mockResolvedValue({ text: '{"summary":"ok"}' }) as unknown as GeminiCall;
    const { client } = build({ call });

    const result = await client.generate(REQUEST);

    expect(result.text).toBe('{"summary":"ok"}');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('times out a slow call and keeps the late reply from crashing', async () => {
    let resolveLate: ((value: { text: string }) => void) | undefined;
    const call = jest.fn().mockImplementation(
      () =>
        new Promise<{ text: string }>((resolve) => {
          resolveLate = resolve;
        }),
    ) as unknown as GeminiCall;
    const { client } = build({ call, maxAttempts: 1 });

    await expect(client.generate(REQUEST)).rejects.toMatchObject({ kind: 'timeout' });
    resolveLate?.({ text: '{"summary":"late"}' });
  });

  it('never leaks the API key in error messages', async () => {
    const call = jest
      .fn()
      .mockRejectedValue(
        new Error(`request to https://example.test/?key=${API_KEY} failed`),
      ) as unknown as GeminiCall;
    const { client } = build({ call, maxAttempts: 1 });

    const error = await client.generate(REQUEST).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiClientError);
    const message = (error as Error).message;
    expect(message).not.toContain(API_KEY);
    expect(message).toContain('[redacted]');
  });

  it('classifies provider statuses and network failures', () => {
    expect(classifyAiError(Object.assign(new Error('x'), { status: 429 }))).toBe('rate_limited');
    expect(classifyAiError(Object.assign(new Error('x'), { status: 403 }))).toBe('auth');
    expect(classifyAiError(Object.assign(new Error('x'), { status: 404 }))).toBe('invalid_request');
    expect(classifyAiError(Object.assign(new Error('x'), { status: 500 }))).toBe('transient');
    expect(classifyAiError(new Error('API key not valid.'))).toBe('auth');
    expect(classifyAiError(new Error('socket hang up'))).toBe('transient');
    expect(classifyAiError(new Error('something else'))).toBe('unknown');
  });

  it('doubles the backoff delay per attempt', () => {
    const { client } = build({ baseDelayMs: 100 });
    expect(client.backoffDelayMs(1)).toBe(100);
    expect(client.backoffDelayMs(2)).toBe(200);
    expect(client.backoffDelayMs(3)).toBe(400);
  });

  it('exposes AiClientError kinds for the processor', () => {
    expect(new AiClientError('rate_limited', 'x').kind).toBe('rate_limited');
  });
});
