import { Injectable } from '@nestjs/common';
import type {
  AiStatus,
  FindingStatus,
  FindingType,
  Prisma,
  Severity,
} from '../../generated/prisma/client';
import { apiError } from '../../common/errors/api-error';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import type { ListFindingsQueryDto } from './dto/list-findings-query.dto';

export interface FindingListItemView {
  id: string;
  analysisRunId: string;
  type: FindingType;
  severity: Severity;
  status: FindingStatus;
  title: string;
  subjectKey: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface FindingNoteView {
  id: string;
  body: string;
  authorId: string;
  createdAt: Date;
}

export interface FindingExplanationView {
  status: AiStatus;
  model: string | null;
  content: Prisma.JsonValue | null;
  validationPassed: boolean | null;
  errorMessage: string | null;
  attempts: number;
  updatedAt: Date;
}

export interface FindingDetailView extends FindingListItemView {
  evidence: Prisma.JsonValue;
  ruleVersion: string;
  updatedAt: Date;
  notes: FindingNoteView[];
  explanation: FindingExplanationView | null;
}

export interface FindingPage {
  data: FindingListItemView[];
  meta: { page: number; pageSize: number; total: number };
}

const FINDING_LIST_SELECT = {
  id: true,
  analysisRunId: true,
  type: true,
  severity: true,
  status: true,
  title: true,
  subjectKey: true,
  createdAt: true,
  resolvedAt: true,
} as const;

@Injectable()
export class FindingsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async list(organizationId: string, query: ListFindingsQueryDto): Promise<FindingPage> {
    const where: Prisma.FindingWhereInput = { organizationId };
    if (query.status) {
      where.status = query.status;
    }
    if (query.severity) {
      where.severity = query.severity;
    }
    if (query.type) {
      where.type = query.type;
    }
    if (query.analysisRunId) {
      where.analysisRunId = query.analysisRunId;
    }

    const page = query.page;
    const pageSize = query.pageSize;

    const { findings, total } = await this.tenantPrisma.run(organizationId, async (tx) => {
      const [findings, total] = await Promise.all([
        tx.finding.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: FINDING_LIST_SELECT,
        }),
        tx.finding.count({ where }),
      ]);
      return { findings, total };
    });

    return { data: findings, meta: { page, pageSize, total } };
  }

  async get(organizationId: string, findingId: string): Promise<FindingDetailView> {
    const finding = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.finding.findUnique({
        where: { id: findingId },
        select: {
          ...FINDING_LIST_SELECT,
          evidence: true,
          ruleVersion: true,
          updatedAt: true,
          notes: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, body: true, authorId: true, createdAt: true },
          },
          explanation: {
            select: {
              status: true,
              model: true,
              content: true,
              validationPassed: true,
              errorMessage: true,
              attempts: true,
              updatedAt: true,
            },
          },
        },
      }),
    );

    if (!finding) {
      throw apiError(404, 'NOT_FOUND', 'Finding not found.');
    }

    return finding;
  }
}
