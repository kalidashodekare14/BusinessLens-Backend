import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { apiError } from '../errors/api-error';
import type { AuthenticatedRequest } from '../types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  currency: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Loads the (authenticated user, :organizationId) membership and attaches the
 * organization to the request. Missing membership returns 404, not 403, so ids
 * are not confirmed to outsiders (§6.2). Must run after JwtAuthGuard.
 */
@Injectable()
export class OrgMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw apiError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const organizationId = request.params.organizationId;
    if (typeof organizationId !== 'string' || !isUUID(organizationId, '4')) {
      throw apiError(400, 'VALIDATION_FAILED', 'Validation failed', [
        { field: 'organizationId', message: 'organizationId must be a UUID' },
      ]);
    }

    // Organization/Membership are non-tenant tables read before an organization
    // context exists, so the bare PrismaService is correct here (§6.3).
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: request.user.userId, organizationId },
      },
      select: {
        role: true,
        organization: { select: ORGANIZATION_SELECT },
      },
    });

    if (!membership) {
      throw apiError(404, 'NOT_FOUND', 'Organization not found.');
    }

    request.organization = { ...membership.organization, role: membership.role };
    return true;
  }
}
