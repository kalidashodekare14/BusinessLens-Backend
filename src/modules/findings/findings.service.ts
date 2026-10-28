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
import { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';
import type { ListFindingsQueryDto } from './dto/list-findings-query.dto';
import { canTransition, resolvedAtFor } from './finding-status';

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

export interface FindingStatusView {
  id: string;
  status: FindingStatus;
  resolvedAt: Date | null;
  updatedAt: Date;
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
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

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

  /**
   * Moves a finding along the workflow (TASKS.md T5.1, §11). The read, the
   * transition check and the write share one tenant transaction, and the update
   * re-checks the status it validated so a concurrent change gets 409 instead of
   * silently overwriting it.
   */
  async updateStatus(
    organizationId: string,
    findingId: string,
    target: FindingStatus,
    actorId: string,
  ): Promise<FindingStatusView> {
    const { from, updated } = await this.tenantPrisma.run(organizationId, async (tx) => {
      const finding = await tx.finding.findUnique({
        where: { id: findingId },
        select: { id: true, status: true },
      });

      if (!finding) {
        throw apiError(404, 'NOT_FOUND', 'Finding not found.');
      }
      if (!canTransition(finding.status, target)) {
        throw apiError(
          409,
          'INVALID_TRANSITION',
          `A finding cannot move from ${finding.status} to ${target}.`,
        );
      }

      const result = await tx.finding.updateMany({
        where: { id: findingId, status: finding.status },
        data: { status: target, resolvedAt: resolvedAtFor(target, new Date()) },
      });
      if (result.count === 0) {
        throw apiError(
          409,
          'INVALID_TRANSITION',
          'The finding changed while it was being updated.',
        );
      }

      const after = await tx.finding.findUniqueOrThrow({
        where: { id: findingId },
        select: { id: true, status: true, resolvedAt: true, updatedAt: true },
      });

      return { from: finding.status, updated: after };
    });

    this.audit.record({
      action: AuditAction.FINDING_STATUS_CHANGED,
      actorId,
      organizationId,
      entityType: 'Finding',
      entityId: findingId,
      metadata: { from, to: updated.status },
    });

    return updated;
  }

  /** Adds an author-attributed plain-text note (T5.2, §11). */
  async addNote(
    organizationId: string,
    findingId: string,
    body: string,
    authorId: string,
  ): Promise<FindingNoteView> {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const finding = await tx.finding.findUnique({
        where: { id: findingId },
        select: { id: true },
      });

      if (!finding) {
        throw apiError(404, 'NOT_FOUND', 'Finding not found.');
      }

      return tx.findingNote.create({
        data: { organizationId, findingId, authorId, body },
        select: { id: true, body: true, authorId: true, createdAt: true },
      });
    });
  }

  /**
   * Deletes a note. Only the author may delete it; a note that is missing, on
   * another finding or written by someone else all answer 404, so the response
   * never confirms what exists (§11).
   */
  async deleteNote(
    organizationId: string,
    findingId: string,
    noteId: string,
    actorId: string,
  ): Promise<void> {
    await this.tenantPrisma.run(organizationId, async (tx) => {
      const note = await tx.findingNote.findUnique({
        where: { id: noteId },
        select: { id: true, findingId: true, authorId: true },
      });

      if (!note || note.findingId !== findingId || note.authorId !== actorId) {
        throw apiError(404, 'NOT_FOUND', 'Note not found.');
      }

      await tx.findingNote.delete({ where: { id: noteId } });
    });
  }
}
