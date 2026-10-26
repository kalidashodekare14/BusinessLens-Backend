import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { apiError } from '../errors/api-error';
import type { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-request';

/**
 * Returns the verified user id attached by JwtAuthGuard. Never reads an id from
 * the body, query or params.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    return request.user;
  },
);
