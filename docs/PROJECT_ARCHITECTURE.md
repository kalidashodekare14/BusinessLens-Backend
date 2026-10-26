# BusinessLens Backend — Project Architecture

Status: v1.0 (MVP design). This file defines **how the system is built**. `TASKS.md` defines the order of work. `Agent.md` defines how coding agents must work. If code and this file disagree, stop and ask the owner; do not silently pick one.

## 1. Product in one paragraph

BusinessLens connects a small business's order data (CSV import in the MVP), calculates metrics deterministically, detects meaningful changes with explicit rules, stores each as a **Finding** with structured **evidence**, asks an AI model to explain the finding in plain language, and lets the user track the investigation (OPEN → INVESTIGATING → RESOLVED).

Core loop: Import data → Analyze → Detect changes → Create findings → Show evidence → Explain with AI → Investigate → Resolve.

## 2. Non-negotiable principles

1. **The backend is the source of truth for every number.** Metrics, percentage changes, severity and evidence are computed by deterministic code. AI never calculates and never invents.
2. **AI explains, it does not decide.** If AI fails, the finding and evidence remain fully usable.
3. **Four kinds of statements stay separate:** observed fact, associated signal, possible explanation, verified cause. The AI must not claim a cause without evidence that proves it. The MVP has no way to verify causes, so the AI never states one as fact.
4. **Tenant isolation is a hard guarantee.** No request, job or query may read or write another organization's data. See section 6.
5. **Never trust the client's organization id.** Every tenant request is authorized through a verified membership.
6. **Build incrementally.** Only the current task. No speculative abstractions, no features outside MVP scope (section 14).

## 3. Technology

| Area | Choice |
| --- | --- |
| Runtime / framework | Node.js (LTS), NestJS, TypeScript (strict) |
| Database | PostgreSQL 16 via Prisma |
| Queue | Redis 7 + BullMQ |
| AI | Google Gemini API (Google AI Studio key), via the official Google GenAI SDK. Model name comes from `GEMINI_MODEL`; verify the SDK package and model name against Google's current docs when implementing |
| Auth | Argon2 password hashing, short-lived JWT access token, opaque rotating refresh token in an httpOnly cookie |
| CSV | `csv-parse` (streaming), `multer` for upload |
| Validation | `class-validator` / `class-transformer` for DTOs, `zod` for AI output |
| Money | Prisma `Decimal` / `decimal.js`; never JavaScript floats |
| Tests | Jest, Supertest, a real PostgreSQL + Redis test environment (docker compose) |
| Packaging | Docker, docker-compose |
| API docs | `@nestjs/swagger` at `/api/docs` |

## 4. Processes

One codebase, two entry points:

- **API** (`src/main.ts`): HTTP only. Never does long work inline.
- **Worker** (`src/worker.ts`): runs BullMQ processors for CSV import, analysis and AI explanation.

PostgreSQL is the source of truth. Redis is only for queues. Losing Redis must never lose business data.

Data flow:

```
Client -> API -> (upload) -> temp file + ImportJob
                 -> confirm -> queue: import-processing -> Worker -> DB (orders, products)
Client -> API -> POST analysis-runs -> queue: analysis -> Worker -> metrics + rules -> Findings (evidence)
                 -> queue: ai-explanation (one job per finding) -> Worker -> Gemini -> AiExplanation
Client polls status endpoints until COMPLETED or FAILED.
```

## 5. Folder structure

```
BusinessLens-Backend/
├─ prisma/ (schema.prisma, migrations/, seed.ts)
├─ sample-data/ (orders.csv, products.csv)
├─ scripts/ (generate-sample-data.ts)
├─ src/
│  ├─ main.ts, worker.ts, app.module.ts, worker.module.ts
│  ├─ config/                 env validation
│  ├─ common/                 decorators, guards, filters, interceptors, utils
│  ├─ prisma/                 prisma.service.ts, tenant-prisma.service.ts
│  ├─ queues/                 queue.constants.ts, queue.module.ts
│  └─ modules/
│     ├─ auth, users, organizations (with memberships)
│     ├─ imports (csv/, imports.processor.ts)
│     ├─ catalog (products, orders: read endpoints)
│     ├─ metrics
│     ├─ analysis (rules/, rule.interface.ts, analysis.service.ts, analysis.processor.ts)
│     ├─ findings
│     ├─ ai (gemini.client.ts, prompt.builder.ts, explanation.schema.ts, number-validator.ts, ai.processor.ts)
│     ├─ dashboard, audit, demo, health
├─ test/ (unit/, integration/, isolation/)
├─ Dockerfile, docker-compose.yml, .env.example, README.md
```

Each module owns its controller, service, DTOs and tests. Modules talk to each other through exported services, not by reaching into each other's files.

## 6. Multi-tenancy and security

### 6.1 Model

A user belongs to organizations through `Membership`. All business data carries `organizationId`.

### 6.2 Layers (all required)

1. **Authentication:** `JwtAuthGuard` validates the access token.
2. **Authorization:** every tenant route lives under `/api/v1/organizations/:organizationId/...`. `OrgMembershipGuard` loads the membership for (current user, `organizationId`) and rejects with 404 if none exists (not 403, so ids are not confirmed to outsiders). `RolesGuard` enforces OWNER-only routes.
3. **Application scoping:** all tenant data access goes through `TenantPrismaService.run(organizationId, fn)`. Feature code must not use the bare `PrismaService` for tenant tables.
4. **Row-Level Security (database):** the last line of defense. See 6.3.

### 6.3 RLS design

- Migrations run as the database owner role. The application connects as a separate role `app_user` that is **not** a superuser and does **not** have `BYPASSRLS`.
- Every tenant table (`ImportJob`, `Product`, `Order`, `OrderItem`, `AnalysisRun`, `Finding`, `FindingNote`, `AiExplanation`, `AuditLog`) has `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`.
- Policy on each (column names are camelCase and must be quoted in SQL):
  `USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK (same expression)`.
  Prisma maps id and organizationId columns to `TEXT`, so both sides of the comparison are text;
  casting to `uuid` fails with "operator does not exist: text = uuid". If the setting is missing,
  the comparison yields NULL and no rows match (fail closed).
- `TenantPrismaService.run` opens an interactive transaction, executes `SELECT set_config('app.organization_id', $1, true)` (transaction-local), then runs the callback with the transaction client. Nothing outside that transaction may touch tenant tables.
- `AuditLog.organizationId` is nullable (auth events happen before an organization exists). Audit rows with a null organization are written by a dedicated code path that sets no organization context and are never readable through tenant endpoints. The RLS policy for `AuditLog` therefore allows inserts when `organizationId` is null and restricts reads to matching organization.
- **`Organization`, `Membership`, `User`, `RefreshToken` have no RLS in the MVP.** They are read before an organization context exists (login, list my organizations, create organization). Their protection is application-level: queries always filter by the authenticated `userId`, and a test proves a user cannot read or modify someone else's rows. (An RLS policy on `Organization` keyed only to the current organization would break listing and creation.)
- Worker jobs carry `organizationId` in the payload and wrap their work in `TenantPrismaService.run`. A job without an organization id is rejected.
- Raw SQL (`$queryRaw`, `$executeRaw`) on tenant tables is allowed only inside `TenantPrismaService.run` and needs a comment explaining why.

### 6.4 Auth details

- Passwords: Argon2id. Minimum length 10. Emails lowercased and unique.
- Access token: JWT, 15 minutes, signed with `JWT_ACCESS_SECRET`, claims: `sub` (user id) only. Organization is never in the token.
- Refresh token: 256-bit random opaque string, stored only as a SHA-256 hash in `RefreshToken`, 7 days. Sent as an httpOnly cookie named `bl_refresh`, `Path=/api/v1/auth`, `Secure` in production, `SameSite=Lax` (use `None; Secure` only if frontend and API are on different sites).
- **Rotation with reuse detection:** `/auth/refresh` revokes the presented token and issues a new one (`replacedById` links them). Presenting an already-revoked token revokes the user's active refresh tokens (assume theft).
- Access token returned in the response body; the frontend keeps it in memory only.
- CORS: only the configured frontend origin, `credentials: true`.
- Rate limiting on `/auth/*` (`@nestjs/throttler`).
- Error messages never reveal whether an email exists (login and register-conflict wording is generic where feasible).
- Secrets only from environment variables. `.env` is git-ignored; `.env.example` has placeholders only.

### 6.5 Other security rules

- Validate every input with DTOs; reject unknown properties (`whitelist` + `forbidNonWhitelisted`).
- Upload limits: 5 MB, `.csv` only, content sniffed, parsed in streaming mode.
- Never return stack traces or internal error text. Log them server-side with a request id.
- Audit log for: register, login, failed login, logout, password change, organization create/update, import confirm, analysis start, finding status change, explanation regenerate, demo data load.
- Never log passwords, tokens, API keys, or full CSV rows.

## 7. Data model

`prisma/schema.prisma` is the source of truth (initial version in Appendix A). Entities: User, Organization, Membership, RefreshToken, ImportJob, Product, Order, OrderItem, AnalysisRun, Finding, FindingNote, AiExplanation, AuditLog.

Conventions: UUID primary keys, UTC timestamps, `Decimal(12,2)` for money, `organizationId` on every tenant table, composite indexes starting with `organizationId`.

Order statuses `cancelled`, `refunded`, `voided` (case-insensitive) are stored but **excluded from all metrics**. The excluded list is one constant in code.

## 8. CSV import pipeline

Types: `ORDERS`, `PRODUCTS`. Orders CSV has **one row per line item**; rows sharing an order id form one order.

Canonical fields:

- ORDERS: `orderId` (required), `orderedAt` (required, date or datetime), `status` (optional, default `completed`), `productName` (required), `sku` (optional), `quantity` (required, positive integer), `unitPrice` (required, non-negative decimal).
- PRODUCTS: `name` (required), `sku` (optional), `price` (optional).

Steps and status (`ImportStatus`):

1. `POST .../imports` (multipart `file`, `type`): store temp file, read header, suggest a column mapping from common synonyms, return `detectedHeaders` and the suggestion. Status `UPLOADED`.
2. `PUT .../imports/:id/mapping`: validate that all required fields are mapped; validate and return a preview of the first 20 rows with per-row errors. Status `MAPPED`.
3. `POST .../imports/:id/confirm`: enqueue `process-import`. Status `PROCESSING`.
4. Worker streams the file, validates each row, processes in batches of 500, updates `processedRows` and `failedRows`. Bad rows are skipped and recorded in `errorReport` (row number, field, reason; capped at 1000 entries). Status `COMPLETED` (even with skipped rows) or `FAILED` (file unreadable or every row invalid).
5. Idempotency: orders are upserted by (`organizationId`, `externalId`); on re-import the order's items are replaced. Products are upserted by (`organizationId`, `name`). `lineTotal = quantity * unitPrice`; `Order.total` = sum of its line totals.
6. The temp file is deleted when processing ends, success or failure. A scheduled cleanup removes orphaned uploads older than 24 hours.

Limits (MVP): 5 MB, about 50,000 rows.

## 9. Analysis engine

### 9.1 Periods

`referenceDate` = the date of the latest non-excluded order in the organization. Current period = the 30 days ending on `referenceDate` (inclusive, UTC days). Previous period = the 30 days immediately before that. Both are stored on `AnalysisRun`. No orders → run fails with a clear message.

### 9.2 Metrics

Per period: revenue (sum of line totals), order count, average order value (revenue / orders), and per-product revenue and units. Computed with SQL aggregates inside the tenant transaction. Results are saved in `AnalysisRun.metricsSnapshot`.

### 9.3 Rules

A rule implements `Rule { id; version; evaluate(metrics): FindingDraft[] }`. Thresholds are constants in the rule file, with the rule `version` string stored on each finding.

| Rule (`FindingType`) | Trigger | Severity |
| --- | --- | --- |
| `REVENUE_DROP` | change in total revenue <= -10% | -10% to -20%: `MEDIUM`; below -20%: `HIGH` |
| `ORDER_COUNT_DROP` | change in order count <= -10% | same as revenue |
| `PRODUCT_REVENUE_DROP` | for each of the top 10 products by previous-period revenue, change <= -30% | -30% to -50%: `MEDIUM`; below -50%: `HIGH` |

Guards (no finding is created when they fail):

- Previous period has fewer than **20** orders.
- Previous value is zero (percentage undefined).

Boundary handling: a change exactly at a threshold triggers it. `changePercent = (current - previous) / previous * 100`, rounded to 1 decimal for display, kept exact in calculation.

Known MVP limitation: each analysis run creates its own findings, so repeated runs on unchanged data produce repeated findings. Deduplication is future work.

### 9.4 Evidence

Every finding stores an `evidence` JSON object containing: `metric`, `current` and `previous` (value, start, end), `changePercent`, `thresholds`, and `relatedMetrics` (for revenue: orders and average order value; for orders: revenue and AOV; for a product: its units and the overall revenue change as context). Money values are strings. Evidence is written once by the rule and never edited.

## 10. AI explanation

- Input to Gemini: the finding `type`, `severity`, `title`, and `evidence` JSON only. No raw rows, no customer data.
- The system prompt requires: use only numbers present in the evidence; separate "Observed", "Associated signals", "Possible explanations (hypotheses, not conclusions)", "Investigation steps", "Uncertainty / what we don't know"; never state a cause as fact; plain English; concise.
- Output is requested as structured JSON and parsed with a `zod` schema (`summary`, `observedFacts[]`, `associatedSignals[]`, `possibleExplanations[]`, `investigationSteps[]`, `uncertainty`).
- **Number validator:** every number appearing in the generated text must match a value in the evidence (allowing rounding and percent/currency formatting). If any number is unsupported, the explanation is rejected (one retry, then `FAILED`).
- Lifecycle (`AiStatus`): `PENDING` → `GENERATING` → `COMPLETED` or `FAILED`. Timeouts and rate limits retry with backoff (max 3 attempts). `errorMessage` stores a safe reason.
- `POST .../findings/:id/explanation` re-queues generation.
- AI calls run only in the worker. The Gemini client is behind an interface so tests use a fake.
- The API key exists only in server environment variables.

## 11. Findings workflow

Statuses: `OPEN` → `INVESTIGATING` → `RESOLVED`, plus `RESOLVED` → `OPEN` (reopen). Other jumps are rejected with 409. Setting `RESOLVED` sets `resolvedAt`; reopening clears it. Resolution is the user's judgment, never automatic. Notes are plain text, author-attributed; an author can delete only their own notes.

## 12. API conventions

- Base path `/api/v1`. Tenant routes: `/api/v1/organizations/:organizationId/...`.
- Success: `{ "data": ..., "meta": { ... } }`. Lists include `meta: { page, pageSize, total }`; default page size 20, max 100.
- Error: `{ "error": { "code": "...", "message": "...", "details": [...] } }` with correct HTTP status (400 validation, 401, 403, 404, 409, 422, 429, 500).
- Money as strings; timestamps ISO 8601 UTC.
- Long operations return `202` with a resource whose `status` the client polls.

### Endpoints (MVP)

Public: `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` (cookie).
Authenticated: `POST /auth/logout`, `GET|PATCH /users/me`, `POST /users/me/change-password`, `POST|GET /organizations`.
Under `/organizations/:organizationId` (member): `GET /`, `GET /products`, `GET /orders`, `POST /imports`, `GET /imports`, `GET /imports/:importId`, `PUT /imports/:importId/mapping`, `POST /imports/:importId/confirm`, `GET /imports/:importId/errors`, `GET /metrics/overview`, `POST|GET /analysis-runs`, `GET /analysis-runs/:runId`, `GET /findings`, `GET /findings/:findingId`, `PATCH /findings/:findingId/status`, `POST /findings/:findingId/notes`, `DELETE /findings/:findingId/notes/:noteId`, `POST /findings/:findingId/explanation`, `GET /dashboard`.
OWNER only: `PATCH /`, `POST /demo-data`, `GET /audit-logs`.

## 13. Testing strategy

- **Unit:** period math, metrics, each rule (including boundaries and guards), CSV parsing/validation, number validator (including adversarial text), status transitions.
- **Integration (real Postgres + Redis):** auth flow, import flow, analysis flow, finding workflow.
- **Isolation (mandatory):** two organizations, two users. For every tenant table, prove at the database level (RLS, with the `app_user` role) that org A's context cannot read or write org B's rows, and that a missing context returns zero rows. For every tenant endpoint, prove user A gets 404 on org B's ids. Cover worker jobs and raw queries.
- **E2E:** register → create organization → import CSV → run analysis → open finding → explanation → change status.
- AI tests use a fake Gemini client. No test calls the real API.
- A task is not done until its tests pass.

## 14. Out of scope for the MVP

Shopify and any other integration, email verification, password recovery, notifications, reports, expense analysis, AI Q&A, automatic monitoring, organization invitations, custom metrics, finding deduplication. Do not build them. Do not add hooks "for later" beyond what is already in the schema.

## 15. Configuration

Environment variables: `NODE_ENV`, `PORT`, `DATABASE_URL` (app_user), `DATABASE_MIGRATION_URL` (owner), `REDIS_URL`, `JWT_ACCESS_SECRET`, `CORS_ORIGIN`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `UPLOAD_DIR`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_ENABLED`. All validated at startup; the app refuses to start on invalid config.

## 16. Deployment

Local: `docker compose up` starts postgres, redis, api, worker. `npm run seed` loads a demo organization and data. Hosted demo (Render or Fly) is a later step; managed Postgres and Redis limits must be checked at that time. Render-style hosts have ephemeral disks, which is why uploads are temporary files deleted after processing.

---

## Appendix A — Initial Prisma schema

```prisma
enum MembershipRole { OWNER MEMBER }
enum ImportType { ORDERS PRODUCTS }
enum ImportStatus { UPLOADED MAPPED PROCESSING COMPLETED FAILED }
enum AnalysisStatus { QUEUED RUNNING COMPLETED FAILED }
enum FindingType { REVENUE_DROP ORDER_COUNT_DROP PRODUCT_REVENUE_DROP }
enum Severity { MEDIUM HIGH }
enum FindingStatus { OPEN INVESTIGATING RESOLVED }
enum AiStatus { PENDING GENERATING COMPLETED FAILED }

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String
  name          String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  memberships   Membership[]
  refreshTokens RefreshToken[]
}

model Organization {
  id          String   @id @default(uuid())
  name        String
  currency    String   @default("USD")
  timezone    String   @default("UTC")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  memberships Membership[]
}

model Membership {
  id             String   @id @default(uuid())
  userId         String
  organizationId String
  role           MembershipRole @default(OWNER)
  createdAt      DateTime @default(now())
  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@unique([userId, organizationId])
  @@index([organizationId])
}

model RefreshToken {
  id           String    @id @default(uuid())
  userId       String
  tokenHash    String    @unique
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?
  createdAt    DateTime  @default(now())
  user         User      @relation(fields: [userId], references: [id])
  @@index([userId])
}

model ImportJob {
  id               String   @id @default(uuid())
  organizationId   String
  createdById      String
  type             ImportType
  status           ImportStatus @default(UPLOADED)
  originalFileName String
  storagePath      String
  detectedHeaders  Json?
  columnMapping    Json?
  totalRows        Int      @default(0)
  processedRows    Int      @default(0)
  failedRows       Int      @default(0)
  errorReport      Json?
  createdAt        DateTime @default(now())
  completedAt      DateTime?
  @@index([organizationId, createdAt])
}

model Product {
  id             String   @id @default(uuid())
  organizationId String
  sku            String?
  name           String
  price          Decimal? @db.Decimal(12, 2)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  items          OrderItem[]
  @@unique([organizationId, name])
}

model Order {
  id             String   @id @default(uuid())
  organizationId String
  externalId     String
  orderedAt      DateTime
  status         String   @default("completed")
  total          Decimal  @db.Decimal(12, 2)
  importJobId    String?
  items          OrderItem[]
  @@unique([organizationId, externalId])
  @@index([organizationId, orderedAt])
}

model OrderItem {
  id             String   @id @default(uuid())
  organizationId String
  orderId        String
  productId      String?
  productName    String
  quantity       Int
  unitPrice      Decimal  @db.Decimal(12, 2)
  lineTotal      Decimal  @db.Decimal(12, 2)
  order          Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product        Product? @relation(fields: [productId], references: [id])
  @@index([organizationId, productId])
  @@index([orderId])
}

model AnalysisRun {
  id              String   @id @default(uuid())
  organizationId  String
  triggeredById   String
  status          AnalysisStatus @default(QUEUED)
  referenceDate   DateTime?
  currentStart    DateTime?
  currentEnd      DateTime?
  previousStart   DateTime?
  previousEnd     DateTime?
  metricsSnapshot Json?
  errorMessage    String?
  createdAt       DateTime @default(now())
  completedAt     DateTime?
  findings        Finding[]
  @@index([organizationId, createdAt])
}

model Finding {
  id             String   @id @default(uuid())
  organizationId String
  analysisRunId  String
  type           FindingType
  severity       Severity
  status         FindingStatus @default(OPEN)
  title          String
  subjectKey     String?
  evidence       Json
  ruleVersion    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  resolvedAt     DateTime?
  analysisRun    AnalysisRun @relation(fields: [analysisRunId], references: [id], onDelete: Cascade)
  notes          FindingNote[]
  explanation    AiExplanation?
  @@index([organizationId, status])
  @@index([analysisRunId])
}

model FindingNote {
  id             String   @id @default(uuid())
  organizationId String
  findingId      String
  authorId       String
  body           String
  createdAt      DateTime @default(now())
  finding        Finding  @relation(fields: [findingId], references: [id], onDelete: Cascade)
  @@index([findingId])
}

model AiExplanation {
  id               String   @id @default(uuid())
  organizationId   String
  findingId        String   @unique
  status           AiStatus @default(PENDING)
  model            String?
  content          Json?
  validationPassed Boolean?
  errorMessage     String?
  attempts         Int      @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  finding          Finding  @relation(fields: [findingId], references: [id], onDelete: Cascade)
}

model AuditLog {
  id             String   @id @default(uuid())
  organizationId String?
  actorId        String?
  action         String
  entityType     String?
  entityId       String?
  metadata       Json?
  createdAt      DateTime @default(now())
  @@index([organizationId, createdAt])
}
```
