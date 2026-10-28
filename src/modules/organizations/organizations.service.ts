import { Injectable } from '@nestjs/common';
import type { MembershipRole } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { PrismaService } from '../../prisma/prisma.service';

export interface OrganizationView {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  role: MembershipRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationPage {
  data: OrganizationView[];
  meta: { page: number; pageSize: number; total: number };
}

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  currency: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Organization and OWNER membership must commit together or not at all. */
  async create(userId: string, input: { name: string }): Promise<OrganizationView> {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.name },
        select: ORGANIZATION_SELECT,
      });

      await tx.membership.create({
        data: { userId, organizationId: organization.id, role: 'OWNER' },
      });

      return { ...organization, role: 'OWNER' };
    });
  }

  async listForUser(userId: string, page: number, pageSize: number): Promise<OrganizationPage> {
    const [memberships, total] = await this.prisma.$transaction([
      this.prisma.membership.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          role: true,
          organization: { select: ORGANIZATION_SELECT },
        },
      }),
      this.prisma.membership.count({ where: { userId } }),
    ]);

    return {
      data: memberships.map(({ role, organization }) => ({ ...organization, role })),
      meta: { page, pageSize, total },
    };
  }

  /**
   * Returns 404 (not 403) when the caller has no membership so organization ids
   * are not confirmed to outsiders (§6.2). T1.6 moves this check into
   * OrgMembershipGuard.
   */
  async getForUser(userId: string, organizationId: string): Promise<OrganizationView> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        role: true,
        organization: { select: ORGANIZATION_SELECT },
      },
    });

    if (!membership) {
      throw apiError(404, 'NOT_FOUND', 'Organization not found.');
    }

    return { ...membership.organization, role: membership.role };
  }
}
