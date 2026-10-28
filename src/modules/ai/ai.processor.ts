import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { isUUID } from 'class-validator';
import type { FindingType, Prisma, Severity } from '../../generated/prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../queues/queue.constants';
import type { QueueProcessor } from '../../queues/queue-processor';
import { TenantJobPayloadError, TenantJobRunner } from '../../queues/tenant-job-runner';
import { AI_CLIENT, AiClientError, safeAiErrorMessage, type AiClient } from './ai-client';
import { explanationContentSchema, type ExplanationContent } from './explanation.schema';
import { validateExplanationNumbers } from './number-validator';
import { buildExplanationRequest } from './prompt.builder';

function readFindingId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const findingId = (payload as Record<string, unknown>).findingId;
  return typeof findingId === 'string' && isUUID(findingId, '4') ? findingId : null;
}

const FORMAT_ERROR = 'The AI explanation did not match the expected format.';
const NUMBERS_ERROR = 'The AI explanation contained numbers that are not in the evidence.';
const DISABLED_ERROR = 'AI explanations are disabled on this server.';
/** One retry on validation failure (§10): two generation rounds in total. */
const MAX_GENERATION_ROUNDS = 2;

interface FindingInput {
  readonly type: FindingType;
  readonly severity: Severity;
  readonly title: string;
  readonly evidence: Prisma.JsonValue;
}

type GenerationOutcome =
  | { readonly ok: true; readonly content: ExplanationContent; readonly model: string }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly validationPassed: boolean | null;
    };

/**
 * AI explanation worker (TASKS.md T5.6, §10).
 *
 * Lifecycle: PENDING -> GENERATING -> COMPLETED | FAILED, always inside tenant
 * transactions. Claiming is a conditional update, so a duplicate delivery — or
 * a finding that already has an explanation — is a no-op. Generation runs
 * outside any transaction (an LLM call must not hold one open) and the result
 * is written only if the row is still GENERATING, so a regeneration started in
 * the meantime wins instead of being overwritten.
 *
 * Validation: parse with the zod schema, then run the number validator. A
 * validation failure is retried once; a failure that survives the retry leaves
 * a safe message on the row. The finding and its evidence stay fully usable
 * either way (§2 principle 2). Transient errors are retried with backoff by
 * the AiClient itself, up to 3 attempts (§10).
 */
@Injectable()
export class AiProcessor implements QueueProcessor {
  readonly queue = QUEUE_NAMES.aiExplanation;
  readonly jobName = JOB_NAMES.generateExplanation;
  private readonly logger = new Logger(AiProcessor.name);

  constructor(
    private readonly tenantJobs: TenantJobRunner,
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(AI_CLIENT) private readonly aiClient: AiClient,
    private readonly config: ConfigService,
  ) {}

  async process(job: Job): Promise<void> {
    const organizationId = this.tenantJobs.resolveOrganizationId(job.data);
    const findingId = readFindingId(job.data);
    if (!findingId) {
      throw new TenantJobPayloadError();
    }

    const finding = await this.tenantPrisma.run(organizationId, (tx) =>
      this.claim(tx, organizationId, findingId),
    );
    if (!finding) {
      // Finding deleted, already explained, or another delivery is running it.
      return;
    }

    if (!this.aiEnabled()) {
      await this.persist(organizationId, findingId, {
        status: 'FAILED',
        errorMessage: DISABLED_ERROR,
        validationPassed: null,
      });
      return;
    }

    const outcome = await this.generate(organizationId, findingId, finding);
    if (!outcome.ok) {
      await this.persist(organizationId, findingId, {
        status: 'FAILED',
        errorMessage: outcome.errorMessage,
        validationPassed: outcome.validationPassed,
      });
      this.logger.warn(`Explanation for finding ${findingId} failed (${outcome.errorMessage})`);
      return;
    }

    await this.persist(organizationId, findingId, {
      status: 'COMPLETED',
      content: outcome.content,
      model: outcome.model,
      validationPassed: true,
      errorMessage: null,
    });
  }

  private aiEnabled(): boolean {
    const value = this.config.getOrThrow<string>('AI_ENABLED');
    return value === 'true' || value === '1';
  }

  /**
   * Loads the finding and moves its explanation PENDING -> GENERATING in one
   * tenant transaction. Returns null when the job must not run: no finding, no
   * unclaimed row, or the row is not PENDING.
   */
  private async claim(
    tx: Prisma.TransactionClient,
    organizationId: string,
    findingId: string,
  ): Promise<FindingInput | null> {
    const finding = await tx.finding.findUnique({
      where: { id: findingId },
      select: { type: true, severity: true, title: true, evidence: true },
    });
    if (!finding) {
      return null;
    }

    const claimed = await tx.aiExplanation.updateMany({
      where: { findingId, status: 'PENDING' },
      data: { status: 'GENERATING', attempts: { increment: 1 }, errorMessage: null },
    });
    if (claimed.count === 1) {
      return finding;
    }

    // No PENDING row to claim. If a row exists at all, someone else owns it.
    const existing = await tx.aiExplanation.findUnique({
      where: { findingId },
      select: { id: true },
    });
    if (existing) {
      return null;
    }

    const created = await tx.aiExplanation.createMany({
      data: { organizationId, findingId, status: 'GENERATING', attempts: 1 },
      skipDuplicates: true,
    });
    return created.count === 1 ? finding : null;
  }

  private async generate(
    organizationId: string,
    findingId: string,
    finding: FindingInput,
  ): Promise<GenerationOutcome> {
    const request = buildExplanationRequest(finding);
    let lastFailure: GenerationOutcome = {
      ok: false,
      errorMessage: FORMAT_ERROR,
      validationPassed: false,
    };

    for (let round = 1; round <= MAX_GENERATION_ROUNDS; round++) {
      let text: string;
      let model: string;
      try {
        const result = await this.aiClient.generate(request);
        text = result.text;
        model = result.model;
      } catch (error) {
        // The client already retried transient failures with backoff; anything
        // that reaches here is final. Log the kind only — never the payload.
        const kind = error instanceof AiClientError ? error.kind : 'unknown';
        this.logger.warn(`AI request for finding ${findingId} failed (${kind}).`);
        return { ok: false, errorMessage: safeAiErrorMessage(kind), validationPassed: null };
      }

      const parsed = explanationContentSchema.safeParse(safeJsonParse(text));
      if (parsed.success) {
        const validation = validateExplanationNumbers(parsed.data, finding.evidence, finding.title);
        if (validation.valid) {
          return { ok: true, content: parsed.data, model };
        }
      }

      // Validation failure: record the attempt, retry once, then give up.
      lastFailure = {
        ok: false,
        errorMessage: parsed.success ? NUMBERS_ERROR : FORMAT_ERROR,
        validationPassed: false,
      };
      if (round < MAX_GENERATION_ROUNDS) {
        await this.countAttempt(organizationId, findingId);
      }
    }

    return lastFailure;
  }

  /** Counts a generation round while the row is still ours (GENERATING). */
  private async countAttempt(organizationId: string, findingId: string): Promise<void> {
    await this.tenantPrisma.run(organizationId, async (tx) => {
      await tx.aiExplanation.updateMany({
        where: { findingId, status: 'GENERATING' },
        data: { attempts: { increment: 1 } },
      });
    });
  }

  /** Writes the terminal state only while the row is still GENERATING. */
  private async persist(
    organizationId: string,
    findingId: string,
    data: {
      status: 'COMPLETED' | 'FAILED';
      errorMessage: string | null;
      validationPassed: boolean | null;
      content?: ExplanationContent;
      model?: string;
    },
  ): Promise<void> {
    await this.tenantPrisma.run(organizationId, async (tx) => {
      await tx.aiExplanation.updateMany({
        where: { findingId, status: 'GENERATING' },
        data: {
          status: data.status,
          errorMessage: data.errorMessage,
          validationPassed: data.validationPassed,
          ...(data.content === undefined ? {} : { content: data.content as Prisma.InputJsonValue }),
          ...(data.model === undefined ? {} : { model: data.model }),
        },
      });
    });
  }
}

/** JSON.parse that yields null for anything unparseable, for safeParse input. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
