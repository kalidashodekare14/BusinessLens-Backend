import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from '../../../src/common/interceptors/response-envelope.interceptor';

const interceptor = new ResponseEnvelopeInterceptor();
const context = {} as ExecutionContext;

function run(value: unknown): unknown {
  const next: CallHandler<unknown> = { handle: () => of(value) };
  let result: unknown;
  interceptor.intercept(context, next).subscribe((v) => (result = v));
  return result;
}

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps a bare object as { data }', () => {
    expect(run({ id: '1' })).toEqual({ data: { id: '1' } });
  });

  it('wraps an array as { data }', () => {
    expect(run([1, 2])).toEqual({ data: [1, 2] });
  });

  it('wraps primitives as { data }', () => {
    expect(run('ok')).toEqual({ data: 'ok' });
  });

  it('wraps null as { data: null }', () => {
    expect(run(null)).toEqual({ data: null });
  });

  it('passes through an envelope that already has data', () => {
    const envelope = { data: [1], meta: { page: 1, pageSize: 20, total: 2 } };
    expect(run(envelope)).toBe(envelope);
  });

  it('passes through a meta-only envelope', () => {
    const envelope = { meta: { total: 0 } };
    expect(run(envelope)).toBe(envelope);
  });

  it('leaves undefined untouched', () => {
    expect(run(undefined)).toBeUndefined();
  });
});
