import { Injectable } from '@nestjs/common';
import { Prisma, type MembershipRole } from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';

export interface OrganizationBase {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationView extends OrganizationBase {
  role: MembershipRole;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Organization and OWNER membership must commit together or not at all. */
  async create(userId: string, input: { name: string }): Promise<OrganizationView> {
    const organization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: input.name },
        select: ORGANIZATION_SELECT,
      });

      await tx.membership.create({
        data: { userId, organizationId: created.id, role: 'OWNER' },
      });

      return { ...created, role: 'OWNER' as const };
    });

    this.audit.record({
      action: AuditAction.ORGANIZATION_CREATED,
      actorId: userId,
      organizationId: organization.id,
      entityType: 'Organization',
      entityId: organization.id,
    });

    return organization;
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

  async update(
    organizationId: string,
    input: { name: string },
    actorId: string,
  ): Promise<OrganizationBase> {
    let organization: OrganizationBase;
    try {
      organization = await this.prisma.organization.update({
        where: { id: organizationId },
        data: { name: input.name },
        select: ORGANIZATION_SELECT,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw apiError(404, 'NOT_FOUND', 'Organization not found.');
      }
      throw error;
    }

    this.audit.record({
      action: AuditAction.ORGANIZATION_UPDATED,
      actorId,
      organizationId,
      entityType: 'Organization',
      entityId: organizationId,
    });

    return organization;
  }
}
