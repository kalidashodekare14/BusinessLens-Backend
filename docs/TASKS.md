# BusinessLens Backend — Tasks

Rules for this file:

- Work **one task at a time**, in order. Do not start a task whose dependencies are unchecked.
- A box is checked `[x]` only after: code is written, relevant tests pass, lint and build pass, and (for 🔒 tasks) the owner has reviewed it. See `Agent.md` for the definition of done.
- 🔒 = **security-critical**. After implementing, stop and give the owner a short review summary. Do not continue until the owner approves.
- Each task should fit roughly 30–60 minutes of agent work. If one is bigger, split it and add the pieces here.
- Day targets assume a 7-day plan at 3–4 focused hours per day. Slipping toward 10 days is acceptable. Never cut tests or isolation checks to hit a day.
- Architecture details live in `PROJECT_ARCHITECTURE.md`. Section numbers below (e.g. §6.3) refer to it.

---

## Phase 0 — Setup (Day 1)

- [x] **T0.1** Initialize the NestJS TypeScript project with strict mode, ESLint, Prettier, Jest. Scripts: `lint`, `test`, `build`, `start:api`, `start:worker`. 
  *Done when:* `npm run lint && npm run test && npm run build` pass on an empty app.
- [x] **T0.2** `docker-compose.yml` with postgres 16 and redis 7 (volumes, healthchecks), `.env.example`, config module that validates all env vars from §15 at startup.
  *Done when:* app fails fast with a clear message on a missing or invalid variable.
- [x] **T0.3** Prisma setup: add `schema.prisma` from Appendix A, first migration, a migration that creates the `app_user` role with least privileges (no superuser, no BYPASSRLS), and two connection URLs (owner for migrations, `app_user` for runtime).
  *Done when:* `prisma migrate dev` works and the app connects as `app_user`.
- [x] **T0.4** App bootstrap: global prefix `/api/v1`, `ValidationPipe` (whitelist, forbidNonWhitelisted, transform), global exception filter producing the §12 error format, response-envelope interceptor, request-id logging, CORS from `CORS_ORIGIN` with credentials, `cookie-parser`. `GET /health` checks DB and Redis.
  *Done when:* an invalid body returns the standard 400 error format; health returns data envelope.

## Phase 1 — Auth and organizations (Day 1–2)

- [x] **T1.0** (prerequisite, owner-approved) Grant `app_user` SELECT/INSERT/UPDATE/DELETE on the four non-tenant tables Phase 1 uses (`User`, `Organization`, `Membership`, `RefreshToken`). Tenant-table grants, `AuditLog` grants and all RLS policies stay in T2.1.
- [x] **T1.1** 🔒 Users module and `POST /auth/register`: email normalization, Argon2id hashing, min password length 10, duplicate email returns a generic 409/400.
  *Depends on:* T0.4. *Tests:* unit (hashing, validation), integration (register, duplicate).
- [x] **T1.2** 🔒 `POST /auth/login`: verify password, issue 15-minute JWT access token (claims: `sub`), create opaque refresh token (stored as SHA-256 hash, 7 days), set `bl_refresh` httpOnly cookie per §6.4. Same generic error for unknown email and wrong password.
  *Depends on:* T1.1.
- [x] **T1.3** 🔒 `POST /auth/refresh` with rotation and reuse detection, and `POST /auth/logout` (revokes token, clears cookie).
  *Tests:* rotated token cannot be reused; reuse revokes the user's active tokens; expired token rejected.
- [x] **T1.4** `JwtAuthGuard`, `@CurrentUser()` decorator, `GET /users/me` (includes organizations), `PATCH /users/me`, `POST /users/me/change-password` (verifies old password, revokes all refresh tokens).
- [x] **T1.5** Organizations: `POST /organizations` (creates organization and OWNER membership in one transaction), `GET /organizations` (only the caller's), `GET /organizations/:organizationId`.
  *Depends on:* T1.4.
- [x] **T1.6** 🔒 `OrgMembershipGuard` (404 when no membership), `RolesGuard` + `@Roles()`, `@CurrentOrg()` decorator. `PATCH /organizations/:organizationId` (OWNER only).
  *Tests:* non-member gets 404; MEMBER cannot call OWNER routes; client-supplied organization ids are never trusted.
- [x] **T1.7** Rate limiting on `/auth/*` using `@nestjs/throttler`.
- [x] **T1.8** `AuditService` (non-blocking, never throws into the request) and audit events for register, login success/failure, logout, password change, organization create/update.

## Phase 2 — Tenant isolation (Day 2)

- [x] **T2.1** 🔒 RLS migration per §6.3: enable and force RLS on all tenant tables, policies with `USING` and `WITH CHECK`, fail-closed when the setting is missing, grants for `app_user`. Special handling for nullable `AuditLog.organizationId`.
- [x] **T2.2** 🔒 `TenantPrismaService.run(organizationId, fn)`: interactive transaction + transaction-local `set_config('app.organization_id', ...)`. Add a request-scoped helper for controllers/services that reads the organization id from the verified guard result only.
- [x] **T2.3** 🔒 Isolation test harness: factory that creates two organizations with two users and sample rows in every tenant table. DB-level tests (using the `app_user` connection): A cannot read, update or delete B's rows; inserting a row with B's `organizationId` under A's context fails; no context returns zero rows.
- [x] **T2.4** 🔒 Worker tenancy helper: BullMQ processor base that requires `organizationId` in the payload, rejects jobs without it, and wraps work in `TenantPrismaService.run`. Test with a job for org A that tries to touch org B.
- [x] **T2.5** Convention check: a test or lint rule that fails if tenant modules import `PrismaService` directly (they must use `TenantPrismaService`). Document the pattern at the top of `src/prisma/tenant-prisma.service.ts`.

## Phase 3 — CSV import (Day 3)

- [x] **T3.1** BullMQ setup: `queue.module.ts`, `queue.constants.ts` (`import-processing`, `analysis`, `ai-explanation`), `worker.ts` and `worker.module.ts` bootstrapping processors.
- [ ] **T3.2** `POST /imports` (multipart): 5 MB limit, `.csv` only, temp file in `UPLOAD_DIR`, create `ImportJob`, read header row, return `detectedHeaders` and a suggested mapping (synonym table per §8). Audit event.
- [ ] **T3.3** Canonical field definitions for ORDERS and PRODUCTS (§8) and the row validator (types, required fields, positive quantity, non-negative price, parseable dates). Pure functions with thorough unit tests.
- [ ] **T3.4** `PUT /imports/:importId/mapping`: validate required fields are mapped, save mapping, return a 20-row preview with per-row errors. Status `MAPPED`.
- [ ] **T3.5** `POST /imports/:importId/confirm` and the `process-import` processor for PRODUCTS (streaming parse, batches of 500, upsert by name, progress updates, capped error report).
- [ ] **T3.6** ORDERS processing: group line items by order id, upsert orders by (`organizationId`, `externalId`), replace items on re-import, compute `lineTotal` and `total`, link or create products, keep excluded statuses stored. Handle an order whose rows span multiple batches correctly.
  *Tests:* re-import is idempotent; mixed good/bad rows; cancelled orders stored.
- [ ] **T3.7** Always delete the temp file when processing ends (success or failure). Scheduled cleanup of uploads older than 24 hours. `GET /imports`, `GET /imports/:importId`, `GET /imports/:importId/errors`.
- [ ] **T3.8** `GET /products` and `GET /orders` (paginated, orders filterable by date range).
- [ ] **T3.9** `scripts/generate-sample-data.ts` creating `sample-data/orders.csv` and `products.csv`: about 5 months of synthetic orders where the last 30 days show a revenue drop, an order-count drop, and one product dropping sharply, so all three rules trigger. Deterministic (seeded random).

## Phase 4 — Analysis (Day 4)

- [ ] **T4.1** Period utility: `referenceDate` from latest non-excluded order, current and previous 30-day windows (§9.1). Unit tests for month boundaries and DST-free UTC behavior.
- [ ] **T4.2** Metrics service (§9.2): revenue, order count, AOV, per-product revenue and units for both periods, excluded statuses removed, via SQL aggregates in the tenant transaction. `GET /metrics/overview`.
- [ ] **T4.3** Rule interface and registry. Implement `REVENUE_DROP` with severity, guards (min 20 previous orders, zero previous value), and evidence (§9.3–9.4). Unit tests at exact thresholds (-10, -20), just inside/outside, and guards.
- [ ] **T4.4** `ORDER_COUNT_DROP` rule with tests.
- [ ] **T4.5** `PRODUCT_REVENUE_DROP` rule (top 10 products by previous revenue, -30% / -50%) with tests.
- [ ] **T4.6** `POST /analysis-runs` (202, creates run `QUEUED`, enqueues), `analysis` processor (sets `RUNNING`, computes periods and metrics, runs rules, stores `metricsSnapshot` and findings, sets `COMPLETED` or `FAILED` with safe message, enqueues one AI job per finding). `GET /analysis-runs`, `GET /analysis-runs/:runId`. Audit event.
  *Done when:* running on the sample data creates findings for all three rules.
- [ ] **T4.7** `GET /findings` (filters: status, severity, type, analysisRunId; pagination; newest first) and `GET /findings/:findingId` (evidence, explanation, notes).

## Phase 5 — Findings workflow and AI (Day 5)

- [ ] **T5.1** `PATCH /findings/:findingId/status` with allowed transitions (§11), `resolvedAt` handling, 409 on invalid transition, audit event.
- [ ] **T5.2** `POST /findings/:findingId/notes` and `DELETE .../notes/:noteId` (author only).
- [ ] **T5.3** Gemini client behind an `AiClient` interface: timeout, retry with exponential backoff, error mapping, no key logging. Fake client for tests. Check the current Google GenAI SDK package and model name before coding.
- [ ] **T5.4** Prompt builder and `zod` output schema (§10). Request structured JSON output. Unit-test the prompt contains only evidence fields.
- [ ] **T5.5** 🔒 Number validator (§10): extract numbers (percent, currency, plain, with thousands separators) from every generated text field and match them against evidence values with rounding tolerance. Tests must include: invented number, number from another finding, rounded number, percent vs ratio, number inside a word, negative numbers.
- [ ] **T5.6** `ai-explanation` processor with `AiExplanation` lifecycle (`PENDING` → `GENERATING` → `COMPLETED`/`FAILED`), validation, one retry on validation failure, up to 3 attempts on transient errors. `POST /findings/:findingId/explanation` to regenerate. Finding detail must still work when the explanation is `FAILED`.
- [ ] **T5.7** `GET /dashboard`: counts of open findings by severity, latest analysis run, key metrics from the latest run.

## Phase 6 — Hardening, demo and contract freeze (Day 6)

- [ ] **T6.1** `GET /audit-logs` (OWNER only, paginated) and verify all §6.5 audit events exist.
- [ ] **T6.2** `POST /demo-data` (OWNER only) and `prisma/seed.ts`: loads the sample dataset into the organization and runs the same import code path (no shortcuts that bypass validation).
- [ ] **T6.3** 🔒 Security review pass using this checklist and report results to the owner: every tenant endpoint has an isolation test; no bare `PrismaService` in tenant modules; no raw SQL outside `TenantPrismaService.run`; no secrets or tokens in logs; CORS limited; cookie flags correct; upload limits enforced; error responses leak nothing; `app_user` lacks BYPASSRLS (test asserts it).
- [ ] **T6.4** `Dockerfile` (one image for API and worker), full `docker-compose.yml` (postgres, redis, api, worker), `README.md` (setup, env, run, test, seed, demo flow).
- [ ] **T6.5** Swagger at `/api/docs` for all endpoints with DTO examples. Freeze the API contract and tag the repo `api-contract-v1`. After this point, endpoint changes need owner approval and a note for the frontend repo.
- [ ] **T6.6** End-to-end test of the full flow (register → organization → import → analysis → finding → explanation (fake AI) → status change), run in CI-style (`npm run test:e2e`).

## Phase 7 — Buffer and next steps (Days 7–10)

Frontend work is tracked in the `BusinessLens-Frontend` repo's own `TASKS.md`, created after T6.5. This phase is for backend fixes found by the frontend, polish, the real Gemini smoke test with a real key, and optional hosted deployment.

- [ ] **T7.1** Real-key smoke test of the explanation flow on sample data; tune the prompt only if the validator rejects valid output often. Record the model name used.
- [ ] **T7.2** Fix API issues reported by frontend integration (each as its own small task).
- [ ] **T7.3** Optional: deploy to Render or Fly (check managed Postgres/Redis limits first), set production cookie and CORS settings.

---

## Later (not in the MVP — do not start)

Shopify integration, email verification and password recovery, notifications, reports, expense analysis, AI Q&A, automatic monitoring, organization invitations, finding deduplication across runs.
