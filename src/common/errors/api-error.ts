import { HttpException } from '@nestjs/common';
import type { ErrorDetail } from '../filters/all-exceptions.filter';

/**
 * Builds an HttpException whose body matches the §12 error envelope fields the
 * global filter understands: { code, message, details }. Use for stable, safe
 * error codes instead of relying on Nest's default messages.
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  details: ErrorDetail[] = [],
): HttpException {
  return new HttpException({ code, message, details }, status);
}
