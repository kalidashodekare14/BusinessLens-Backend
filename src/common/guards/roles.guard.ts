import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '../../generated/prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { apiError } from '../errors/api-error';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Enforces @Roles(...) using the role loaded by OrgMembershipGuard. Routes
 * without @Roles are open to any member. Must run after OrgMembershipGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.organization || !required.includes(request.organization.role)) {
      throw apiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }

    return true;
  }
}
