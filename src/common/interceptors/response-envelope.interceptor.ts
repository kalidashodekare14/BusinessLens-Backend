import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Every response body uses the §12 envelope { data, ... }:
 * - handler returns undefined (204-style) -> untouched
 * - handler returns an object that already has a `data` or `meta` key -> passed through
 *   (this is how list endpoints supply `meta: { page, pageSize, total }`)
 * - anything else (objects, arrays, primitives) -> wrapped as { data: value }
 *
 * Convention: bare resources must not use top-level `data` or `meta` keys.
 */
function isEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ('data' in value || 'meta' in value)
  );
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    return next
      .handle()
      .pipe(map((value) => (value === undefined || isEnvelope(value) ? value : { data: value })));
  }
}
