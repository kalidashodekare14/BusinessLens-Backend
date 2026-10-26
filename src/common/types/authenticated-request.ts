import type { Request } from 'express';
import type { MembershipRole } from '../../generated/prisma/client';

/** What JwtAuthGuard attaches after verifying an access token. */
export interface AuthenticatedUser {
  userId: string;
}

/** What OrgMembershipGuard attaches after verifying the caller's membership. */
export interface CurrentOrganization {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  role: MembershipRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  organization?: CurrentOrganization;
}
