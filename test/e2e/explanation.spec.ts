import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { Job } from 'bullmq';
import { type AiClient } from '../../src/modules/ai/ai-client';
import { AiProcessor } from '../../src/modules/ai/ai.processor';
import { EXPLANATION_FIELDS } from '../../src/modules/ai/explanation.schema';
import { Prisma } from '../../src/generated/prisma/client';
import { AuditAction } from '../../src/modules/audit/audit.actions';
import { AuditService } from '../../src/modules/audit/audit.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../src/queues/queue.constants';
import { QueueService } from '../../src/queues/queue.service';
import { TenantJobPayloadError, TenantJobRunner } from '../../src/queues/tenant-job-runner';
import { deleteOrganizationsById, deleteUsersByEmail } from '../helpers/db';
import {
  FakeAiClient,
  VALID_EXPLANATION,
  fakeExplanationText,
  transientError,
} from '../helpers/fake-ai.client';
import {
  loginUser,
  registerUser,
  uniqueEmail,
  type LoginSession,
  type RegisteredUser,
} from '../helpers/auth';
import { createTestApp, type TestApp } from '../helpers/test-app';

const FORMAT_ERROR = 'The AI explanation did not match the expected format.';
const NUMBERS_ERROR = 'The AI explanation contained numbers that are not in the evidence.';
const DISABLED_ERROR = 'AI explanations are disabled on this server.';

const EVIDENCE = {
  metric: 'revenue',
  current: { value: '80.00', start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' },
  previous: {
    value: '100.00',
    start: '2026-08-02T00:00:00.000Z',
    end: '2026-08-31T00:00:00.000Z',
  },
  changePercent: -20,
  thresholds: { trigger: -10, high: -20 },
  relatedMetrics: {
    orderCount: { current: 10, previous: 20, changePercent: -50 },
    averageOrderValue: { current: '8.00', previous: '5.00', changePercent: 60 },
  },
};

describe('ai explanation (e2e)', () => {
  let ctx: TestApp;
  let user: RegisteredUser;
  let session: LoginSession;
  let organizationId: string;
  let findingId: string;
  let queueSpy: jest.SpyInstance;
  let recordSpy: jest.SpyInstance;
  const createdEmails: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.server, { email: uniqueEmail('explanation') });
    createdEmails.push(user.email);
    session = await loginUser(ctx.server, user);
  });

  beforeEach(async () => {
    const created = await request(ctx.server)
      .post('/api/v1/organizations')
      .set(auth())
      .send({ name: 'Explanation Co' });
    expect(created.status).toBe(201);
    organizationId = created.body.data.id;
    createdOrganizationIds.push(organizationId);
    findingId = await seedFinding();

    queueSpy = jest.spyOn(ctx.app.get(QueueService), 'enqueue').mockResolvedValue('queued-job-id');
    recordSpy = jest.spyOn(ctx.app.get(AuditService), 'record');
  });

  afterEach(() => {
    queueSpy.mockRestore();
    recordSpy.mockRestore();
  });

  afterAll(async () => {
    const tenant = ctx.app.get(TenantPrismaService);
    for (const id of createdOrganizationIds) {
      await tenant.run(id, (tx) => tx.aiExplanation.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.findingNote.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.finding.deleteMany({ where: { organizationId: id } }));
      await tenant.run(id, (tx) => tx.analysisRun.deleteMany({ where: { organizationId: id } }));
    }
    await deleteOrganizationsById(ctx.app, createdOrganizationIds);
    await deleteUsersByEmail(ctx.app, createdEmails);
    await ctx.close();
  });

  function auth(token = session.accessToken): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  function endpoint(orgId = organizationId): string {
    return `/api/v1/organizations/${orgId}/findings`;
  }

  async function seedFinding(orgId = organizationId): Promise<string> {
    return ctx.app.get(TenantPrismaService).run(orgId, async (tx) => {
      const run = await tx.analysisRun.create({
        data: { organizationId: orgId, triggeredById: user.id, status: 'COMPLETED' },
        select: { id: true },
      });
      const finding = await tx.finding.create({
        data: {
          organizationId: orgId,
          analysisRunId: run.id,
          type: 'REVENUE_DROP',
          severity: 'HIGH',
          status: 'OPEN',
          title: 'Revenue dropped 20.0%',
          evidence: EVIDENCE as unknown as Prisma.InputJsonValue,
          ruleVersion: 'test-v1',
        },
        select: { id: true },
      });
      return finding.id;
    });
  }

  function aiJob(targetFindingId: string, orgId = organizationId): Job {
    return {
      id: `job-${targetFindingId}`,
      name: JOB_NAMES.generateExplanation,
      data: { organizationId: orgId, findingId: targetFindingId },
    } as Job;
  }

  function newProcessor(client: AiClient, config?: ConfigService): AiProcessor {
    return new AiProcessor(
      ctx.app.get(TenantJobRunner),
      ctx.app.get(TenantPrismaService),
      client,
      config ?? ctx.app.get(ConfigService),
    );
  }

  async function runProcessor(client: AiClient, orgId = organizationId): Promise<void> {
    await newProcessor(client).process(aiJob(findingId, orgId));
  }

  async function storedExplanation(orgId = organizationId, id = findingId) {
    return ctx.app
      .get(TenantPrismaService)
      .run(orgId, (tx) => tx.aiExplanation.findUnique({ where: { findingId: id } }));
  }

  const disabledConfig = { getOrThrow: () => 'false' } as unknown as ConfigService;

  describe('generation lifecycle', () => {
    it('creates the explanation, completes it and shows it in the finding detail', async () => {
      const client = new FakeAiClient();
      await runProcessor(client);

      const row = await storedExplanation();
      expect(row).toMatchObject({
        status: 'COMPLETED',
        model: 'fake-model',
        validationPassed: true,
        errorMessage: null,
        attempts: 1,
      });
      expect(row?.content).toEqual(VALID_EXPLANATION);

      const detail = await request(ctx.server).get(`${endpoint()}/${findingId}`).set(auth());
      expect(detail.status).toBe(200);
      expect(detail.body.data.explanation).toMatchObject({
        status: 'COMPLETED',
        model: 'fake-model',
        validationPassed: true,
        content: VALID_EXPLANATION,
      });
    });

    it('sends only type, severity, title and evidence to the model', async () => {
      const client = new FakeAiClient();
      await runProcessor(client);

      expect(client.calls).toHaveLength(1);
      const payload = JSON.parse(client.calls[0].prompt) as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(['evidence', 'severity', 'title', 'type']);
      expect(payload.evidence).toEqual(EVIDENCE);
      expect(client.calls[0].responseJsonSchema.required).toEqual([...EXPLANATION_FIELDS]);
    });

    it('treats a duplicate delivery as a no-op', async () => {
      const client = new FakeAiClient();
      await runProcessor(client);
      await runProcessor(client);

      expect(client.calls).toHaveLength(1);
      expect(await storedExplanation()).toMatchObject({ status: 'COMPLETED', attempts: 1 });
    });

    it('ignores a job whose finding no longer exists', async () => {
      const client = new FakeAiClient();
      const ghostId = await seedFinding();
      await ctx.app
        .get(TenantPrismaService)
        .run(organizationId, (tx) => tx.finding.delete({ where: { id: ghostId } }));

      await newProcessor(client).process(aiJob(ghostId));

      expect(client.calls).toHaveLength(0);
      expect(
        await ctx.app
          .get(TenantPrismaService)
          .run(organizationId, (tx) =>
            tx.aiExplanation.findUnique({ where: { findingId: ghostId } }),
          ),
      ).toBeNull();
    });

    it('does not let an org A job touch a finding owned by org B', async () => {
      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Worker Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherFindingId = await seedFinding(otherOrg.body.data.id);

      const client = new FakeAiClient();
      await newProcessor(client).process(aiJob(otherFindingId, organizationId));

      expect(client.calls).toHaveLength(0);
      expect(await storedExplanation(otherOrg.body.data.id, otherFindingId)).toBeNull();
    });

    it('rejects a payload without a valid finding id', async () => {
      const client = new FakeAiClient();
      const job = {
        id: 'job-x',
        name: JOB_NAMES.generateExplanation,
        data: { organizationId, findingId: 'not-a-uuid' },
      } as Job;

      await expect(newProcessor(client).process(job)).rejects.toBeInstanceOf(TenantJobPayloadError);
      expect(client.calls).toHaveLength(0);
    });
  });

  describe('validation', () => {
    it('retries malformed JSON once, then stores FAILED with a safe message', async () => {
      const client = new FakeAiClient([
        { kind: 'text', text: 'not json at all' },
        { kind: 'text', text: '{"summary": "also not valid"}' },
      ]);

      await runProcessor(client);

      expect(client.calls).toHaveLength(2);
      const row = await storedExplanation();
      expect(row).toMatchObject({
        status: 'FAILED',
        errorMessage: FORMAT_ERROR,
        validationPassed: false,
        attempts: 2,
      });
      expect(row?.content).toBeNull();

      // The finding detail still works with a FAILED explanation (§2 principle 2).
      const detail = await request(ctx.server).get(`${endpoint()}/${findingId}`).set(auth());
      expect(detail.status).toBe(200);
      expect(detail.body.data.explanation).toMatchObject({
        status: 'FAILED',
        errorMessage: FORMAT_ERROR,
        content: null,
      });
      expect(detail.body.data.evidence).toEqual(EVIDENCE);
    });

    it('retries once and rejects an explanation with invented numbers', async () => {
      const invented = fakeExplanationText({ summary: 'Revenue was 555.00 this period.' });
      const client = new FakeAiClient([
        { kind: 'text', text: invented },
        { kind: 'text', text: invented },
      ]);

      await runProcessor(client);

      expect(client.calls).toHaveLength(2);
      expect(await storedExplanation()).toMatchObject({
        status: 'FAILED',
        errorMessage: NUMBERS_ERROR,
        validationPassed: false,
        attempts: 2,
      });
    });

    it('succeeds when the retry produces valid output', async () => {
      const client = new FakeAiClient([
        { kind: 'text', text: 'not json' },
        { kind: 'text', text: JSON.stringify(VALID_EXPLANATION) },
      ]);

      await runProcessor(client);

      expect(client.calls).toHaveLength(2);
      expect(await storedExplanation()).toMatchObject({
        status: 'COMPLETED',
        validationPassed: true,
        errorMessage: null,
        attempts: 2,
      });
    });

    it('marks FAILED with a safe message when the client gives up', async () => {
      const client = new FakeAiClient([{ kind: 'error', error: transientError() }]);

      await runProcessor(client);

      expect(client.calls).toHaveLength(1);
      expect(await storedExplanation()).toMatchObject({
        status: 'FAILED',
        errorMessage: 'The AI service is temporarily unavailable.',
        validationPassed: null,
        attempts: 1,
      });
    });

    it('fails without calling the model when AI is disabled', async () => {
      const client = new FakeAiClient();

      await newProcessor(client, disabledConfig).process(aiJob(findingId));

      expect(client.calls).toHaveLength(0);
      expect(await storedExplanation()).toMatchObject({
        status: 'FAILED',
        errorMessage: DISABLED_ERROR,
      });
    });
  });

  describe('POST /findings/:findingId/explanation', () => {
    it('resets the row to PENDING, enqueues and records an audit event', async () => {
      const client = new FakeAiClient();
      await runProcessor(client);
      expect((await storedExplanation())?.status).toBe('COMPLETED');

      const res = await request(ctx.server)
        .post(`${endpoint()}/${findingId}/explanation`)
        .set(auth());

      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({
        findingId,
        status: 'PENDING',
        attempts: 0,
      });
      expect(await storedExplanation()).toMatchObject({
        status: 'PENDING',
        attempts: 0,
        content: null,
        errorMessage: null,
      });

      // No custom job id: a regeneration must not dedupe against the completed job.
      expect(queueSpy).toHaveBeenCalledWith(
        QUEUE_NAMES.aiExplanation,
        JOB_NAMES.generateExplanation,
        { organizationId, findingId },
      );
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EXPLANATION_REGENERATED,
          actorId: user.id,
          organizationId,
          entityType: 'Finding',
          entityId: findingId,
        }),
      );

      await runProcessor(client);
      expect(await storedExplanation()).toMatchObject({
        status: 'COMPLETED',
        attempts: 1,
        model: 'fake-model',
      });
    });

    it('marks the explanation FAILED and returns 503 when Redis cannot accept the job', async () => {
      queueSpy.mockRejectedValueOnce(new Error('redis unavailable'));

      const res = await request(ctx.server)
        .post(`${endpoint()}/${findingId}/explanation`)
        .set(auth());

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('EXPLANATION_QUEUE_UNAVAILABLE');
      expect(await storedExplanation()).toMatchObject({
        status: 'FAILED',
        errorMessage: 'The explanation could not be queued.',
      });
    });

    it('returns 404 for missing, cross-organization and outsider ids', async () => {
      const missing = await request(ctx.server)
        .post(`${endpoint()}/00000000-0000-4000-8000-000000000000/explanation`)
        .set(auth());
      expect(missing.status).toBe(404);

      const otherOrg = await request(ctx.server)
        .post('/api/v1/organizations')
        .set(auth())
        .send({ name: 'Other Explanation Co' });
      expect(otherOrg.status).toBe(201);
      createdOrganizationIds.push(otherOrg.body.data.id);
      const otherFindingId = await seedFinding(otherOrg.body.data.id);

      // Caller's organization path, but the finding lives in the other one:
      // the tenant transaction must not see it.
      const crossOrg = await request(ctx.server)
        .post(`${endpoint()}/${otherFindingId}/explanation`)
        .set(auth());
      expect(crossOrg.status).toBe(404);
      // And the caller is a member of both orgs, so guard-level denial is
      // covered by the outsider case below.

      const outsider = await registerUser(ctx.server, { email: uniqueEmail('explanation-out') });
      createdEmails.push(outsider.email);
      const outsiderSession = await loginUser(ctx.server, outsider);
      const outside = await request(ctx.server)
        .post(`${endpoint()}/${findingId}/explanation`)
        .set(auth(outsiderSession.accessToken));
      expect(outside.status).toBe(404);

      expect(queueSpy).not.toHaveBeenCalled();
    });
  });
});
