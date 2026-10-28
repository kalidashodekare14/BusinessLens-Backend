import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '../../generated/prisma/client';

export const ROLES_KEY = 'roles';

/** Marks a route as restricted to the given membership roles (enforced by RolesGuard). */
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);
