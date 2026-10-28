import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { apiError } from '../errors/api-error';
import type { AuthenticatedRequest, CurrentOrganization } from '../types/authenticated-request';

/**
 * Returns the organization verified by OrgMembershipGuard. The id always comes
 * from the route parameter and a real membership lookup, never from the body,
 * query string or token.
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentOrganization => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.organization) {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    return request.organization;
  },
);
