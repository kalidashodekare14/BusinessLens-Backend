# Agent.md — How coding agents work in BusinessLens-Backend

This file is for coding agents (opencode and others). Read it fully at the start of every session. The human owner reviews your work; you are not the final authority.

## 1. Read before you code

At the start of a session, read, in this order:

1. `Agent.md` (this file)
2. `PROJECT_ARCHITECTURE.md` (the design; source of truth)
3. `TASKS.md` (find the first unchecked task whose dependencies are done)

If the owner names a task, work on that task. If it conflicts with the architecture, say so and stop.

## 2. The working loop

For each task:

1. **Inspect first.** Look at the existing code and tests relevant to the task. Do not assume files or functions exist; check.
2. **State a short plan** (3–6 bullets) before changing files: what you will add or change, and which tests you will write.
3. **Implement only the current task.** No drive-by refactors, no extra features, no "while I'm here" changes. If you notice a problem elsewhere, report it at the end; do not fix it.
4. **Write or update tests** for the behavior (see section 5).
5. **Verify:** run `npm run lint`, the relevant tests, and `npm run build`. Fix failures you caused. Report failures you did not cause.
6. **Report** in this format, keeping it short:
   - What changed (files)
   - Tests run and results (paste the actual summary line)
   - Anything uncertain or any decision you made
   - Problems noticed outside the task
7. **Mark the task `[x]` in `TASKS.md` only after step 5 passes.** For 🔒 tasks, do not mark it until the owner says it is approved.

One task per session turn. Do not start the next task unless the owner asks.

## 3. Hard rules (never break)

**Tenant isolation**
- Tenant tables are: `ImportJob`, `Product`, `Order`, `OrderItem`, `AnalysisRun`, `Finding`, `FindingNote`, `AiExplanation`, `AuditLog`. Access them only through `TenantPrismaService.run(organizationId, ...)`.
- Never read `organizationId` from a request body, query string or token. It comes from the verified `OrgMembershipGuard` result. Job payloads carry it, and the worker wraps work in `TenantPrismaService.run`.
- Do not weaken, bypass or disable RLS, the `app_user` role, or the guards, even temporarily, even for tests. Do not connect the application as the owner or a superuser.
- Every new tenant endpoint or tenant query needs an isolation test.
- Raw SQL on tenant tables is allowed only inside `TenantPrismaService.run` with a comment explaining why.

**Security**
- Never commit secrets, real API keys, `.env`, or real customer data. Use `.env.example` placeholders.
- Never log passwords, tokens, cookies, the Gemini key, or CSV row contents.
- Never return stack traces or internal messages to clients. Use the standard error format.
- Validate all input with DTOs. Keep `whitelist` and `forbidNonWhitelisted` on.
- Do not change auth, token, cookie or password-hashing behavior unless the task says so.

**Correctness**
- Money is `Decimal`, never `number`. Percentages are computed from exact values.
- Metrics, percentage changes, severity and evidence are calculated only in deterministic backend code. AI never computes numbers.
- AI code must never present a cause as fact. The explanation prompt and the number validator in `PROJECT_ARCHITECTURE.md` §10 are requirements, not suggestions.
- If AI fails, the finding and its evidence must still be returned.

**Scope**
- Do not build anything listed under "Out of scope" in the architecture or "Later" in `TASKS.md`.
- Do not add a new dependency without saying why in your report. Prefer what is already installed. Check that a package really exists and is maintained before adding it.
- Do not rename or reorganize folders, change the Prisma schema, or change an endpoint's request/response shape unless the task requires it. If the task requires a schema change, make a new migration; never edit an applied migration.
- After task T6.5 (`api-contract-v1`), do not change public endpoint contracts without owner approval.

## 4. Code conventions

- TypeScript strict. No `any` unless commented with a reason. No unused code left behind.
- NestJS module per feature: controller (thin), service (logic), DTOs, tests. Controllers contain no business logic.
- Responses use the `{ data, meta }` envelope; errors use `{ error: { code, message, details } }`.
- Error codes are stable UPPER_SNAKE strings (e.g. `VALIDATION_FAILED`, `FINDING_INVALID_TRANSITION`).
- Timestamps UTC; ids UUID; money as strings in JSON.
- Keep functions small and named for what they do. Pure functions for calculations so they are easy to test.
- Comments explain *why*, not *what*.
- Conventional commits, one logical change each: `feat(auth): add refresh rotation`, `test(isolation): cover orders`, `fix(imports): delete temp file on failure`. Do not commit unless the owner asks you to.

## 5. Testing rules

- No task is done without tests that fail when the behavior is wrong.
- Unit tests for pure logic (periods, rules, validators, parsers, transitions).
- Integration tests use real PostgreSQL and Redis from docker compose, not mocks of the database.
- The AI client is always faked in tests. Never call the real Gemini API in automated tests.
- Rule tests must cover exact thresholds, just-inside and just-outside values, and the guards (fewer than 20 previous orders, zero previous value).
- Isolation tests are mandatory for tenant code (see `TASKS.md` Phase 2). Do not delete or loosen them to make something pass.
- If a test is flaky or wrong, fix the cause and tell the owner. Never skip a test to get green.

## 6. 🔒 Security-critical tasks

Tasks marked 🔒 touch auth, tokens, tenancy, RLS or AI number validation. For these:

- Keep the change as small as possible.
- After implementing and testing, give the owner a review summary: the key code locations, the security decisions made, and which tests prove them. Then stop and wait.
- Do not mark the task complete until the owner approves.

## 7. When to stop and ask

Stop and ask the owner instead of guessing when:

- The task contradicts `PROJECT_ARCHITECTURE.md` or another task.
- A requirement is ambiguous in a way that changes behavior or security.
- You would need to change the schema, an endpoint contract, an already-applied migration, or the guards.
- A dependency is missing, deprecated or its API differs from what the docs here assume (for example the Gemini SDK or model name).
- Tests fail for reasons outside your change.
- The task is larger than about an hour. Propose a split and add it to `TASKS.md`.

Never fabricate: do not invent file contents you have not read, test results you have not run, or API behavior you have not checked. If you could not run something, say so.

## 8. Handling uncertainty about external services

Gemini model names, SDK package names and versions, and platform limits (Render, Fly, free tiers) change over time. Do not rely on memory. Check the official documentation or the installed package, and record what you used (model name, versions) in your report.

## 9. Keeping the docs honest

- `TASKS.md`: check boxes only when truly done; add new sub-tasks when work is split.
- `PROJECT_ARCHITECTURE.md`: if you must change the design to make a task work, propose the edit to the owner. Do not edit it silently.
- `README.md`: keep setup and run instructions accurate when you change scripts or environment variables.

## 10. Useful commands

```
docker compose up -d postgres redis   # dependencies
npm run start:api                     # API
npm run start:worker                  # worker
npm run lint
npm run test                          # unit
npm run test:e2e                      # integration / e2e
npm run build
npx prisma migrate dev                # create/apply migration (dev)
npx prisma generate
```

(Script names are created in task T0.1. If a command here does not exist yet, create it as part of that task rather than inventing a different one.)

## 11. opencode notes

opencode loads `AGENTS.md` by default. Because this repo uses `Agent.md`, add an `opencode.json` at the repo root that lists the instruction files explicitly, for example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["Agent.md", "PROJECT_ARCHITECTURE.md"]
}
```

Check opencode's current documentation for the exact config keys, since they may change. A good first prompt for a session:

> Read Agent.md, PROJECT_ARCHITECTURE.md and TASKS.md. Work on task T0.1 only. Give me your plan first, then implement, run the checks, and report in the format from Agent.md section 2.
