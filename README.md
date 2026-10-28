# BusinessLens Backend

Backend for BusinessLens: CSV import, deterministic metrics, rule-based findings, and AI explanations for small businesses. The design lives in [`docs/PROJECT_ARCHITECTURE.md`](docs/PROJECT_ARCHITECTURE.md); the task order lives in [`docs/TASKS.md`](docs/TASKS.md).

## Stack


- Node.js 22+ / NestJS / TypeScript (strict)
- PostgreSQL 16 through Prisma (runtime role `app_user`, migrations as the owner role)
- Redis 7 + BullMQ for imports, analysis and AI explanation jobs
- Google Gemini through `@google/genai` (the model comes from `GEMINI_MODEL`)
- Jest + Supertest against real PostgreSQL and Redis

## Prerequisites

- Node.js `>=22.12`
- Docker (for PostgreSQL and Redis)
- npm

## Quick start (host)

```powershell
# 1. Environment
Copy-Item .env.example .env
# Edit .env: set a long random JWT_ACCESS_SECRET. AI_ENABLED=false works
# without a Gemini key; the rest of the app is fully usable.

# 2. Dependencies and database
npm ci
docker compose up -d postgres redis
npx prisma migrate deploy

# 3. Run the API and worker in separate terminals
npm run start:api
npm run start:worker
```

The API listens on `http://localhost:3000`; health is `GET /api/v1/health`. Swagger UI is at `http://localhost:3000/api/docs` (JSON at `/api/docs-json`).

Postgres is exposed on host port `5434` and Redis on `6381` because `5432`/`6379` are often taken by other local projects.

## Full stack with Docker Compose

```powershell
Copy-Item .env.example .env
# Set JWT_ACCESS_SECRET (and GEMINI_API_KEY/GEMINI_MODEL if AI_ENABLED=true)

docker compose up --build
```

Compose starts:

| Service | Purpose |
| --- | --- |
| `postgres` | PostgreSQL 16 (host `5434`) |
| `redis` | Redis 7 (host `6381`) |
| `migrate` | one-shot `prisma migrate deploy` using the owner role |
| `api` | API on `http://localhost:3000` |
| `worker` | BullMQ processors (imports, analysis, AI) |

`api` and `worker` use the same runtime image; only the command differs. The `uploads` volume is shared because the API writes CSV files and the worker reads them. The `migrate` service uses the `build` image target because it needs the Prisma CLI.

The schema is applied automatically by `migrate`; to run migrations manually:

```powershell
docker compose run --rm migrate
```

Stop the stack with `docker compose down` (add `-v` to delete local data volumes).

## Environment variables

All application variables are validated at startup; the process refuses to boot with a clear `CONFIG_INVALID` message if any is missing or malformed.

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `development`, `production` or `test` |
| `PORT` | API port (default `3000`) |
| `DATABASE_URL` | runtime connection as `app_user` (no superuser, no `BYPASSRLS`) |
| `DATABASE_MIGRATION_URL` | owner connection used by `prisma migrate`; must differ from `DATABASE_URL` |
| `REDIS_URL` | Redis connection string |
| `JWT_ACCESS_SECRET` | 32+ character secret for 15-minute access tokens |
| `CORS_ORIGIN` | comma-separated frontend origins, scheme + host only |
| `COOKIE_SECURE` | `true` in production; required when `COOKIE_SAMESITE=none` |
| `COOKIE_SAMESITE` | `lax`, `strict` or `none` |
| `UPLOAD_DIR` | temporary CSV upload directory (default `./uploads`) |
| `GEMINI_API_KEY` | server-only Gemini key |
| `GEMINI_MODEL` | model name, for example `gemini-2.5-flash` |
| `AI_ENABLED` | `true` to generate explanations; findings and evidence still work when `false` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | only used by `docker-compose.yml` for the local Postgres container |

`.env` is git-ignored; `.env.example` contains placeholders only. Never commit real keys or customer data.

## Scripts

| Command | Description |
| --- | --- |
| `npm run start:api` | build and start the HTTP API |
| `npm run start:worker` | build and start the BullMQ worker |
| `npm run build` | `prisma generate` + TypeScript build |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | unit tests |
| `npm run test:e2e` | integration, isolation and e2e tests (needs Postgres + Redis) |
| `npm run seed` | load the demo organization through the real import pipeline |
| `npm run generate:sample-data` | regenerate deterministic `sample-data/*.csv` |
| `npx prisma migrate dev` | create/apply a migration in development |
| `npx prisma migrate deploy` | apply committed migrations |

## Demo data

`npm run seed` creates a local demo identity and an organization, then queues the sample CSVs through the same upload → mapping → confirm path a client uses. Start the worker so the queued imports finish.

- Email: `demo@businesslens.test`
- Password: `businesslens-demo`
- Organization: `Demo Organization`

The demo credentials are local-only and must never be reused in a hosted environment.

Then run an analysis and open the generated findings:

```
POST /api/v1/organizations/:organizationId/analysis-runs
GET  /api/v1/organizations/:organizationId/findings
```

## Testing

The integration/e2e suite talks to real PostgreSQL and Redis, not mocks:

```powershell
docker compose up -d postgres redis
npx prisma migrate deploy
npm run test:e2e
```

The Gemini client is always faked in tests (`test/helpers/fake-ai.client.ts`); no automated test calls the real API. Set `AI_ENABLED=true` in `.env` if a test needs the explanation lifecycle to run.

## Security and tenancy

- Every tenant route lives under `/api/v1/organizations/:organizationId/...` and is authorized by `JwtAuthGuard` + `OrgMembershipGuard` (404 for non-members).
- All tenant queries run inside `TenantPrismaService.run`, which sets a transaction-local `app.organization_id`.
- Row-Level Security is enabled and forced on every tenant table; `app_user` is not a superuser and cannot bypass RLS.
- CSV uploads are limited to 5 MB and `.csv`, and are deleted when processing ends.
- Errors use `{ error: { code, message, details } }` and never expose stack traces or internal messages.

## Production checklist

- Run PostgreSQL and Redis as managed services; set `NODE_ENV=production`.
- Set `COOKIE_SECURE=true` (startup rejects insecure cookies in production). Use `COOKIE_SAMESITE=none` only when the frontend and API are on different sites, which also requires `COOKIE_SECURE=true`.
- Set `CORS_ORIGIN` to the exact frontend origin(s).
- Set a strong `JWT_ACCESS_SECRET` and a real `GEMINI_API_KEY`.
- Change the `app_user` password. It is created by an applied migration with a local development password; rotate it with a new migration or a managed-database role change, and update `DATABASE_URL`.
- Keep `AI_ENABLED=false` until the key and model are verified.
- Serve the API over HTTPS; the docs UI (`/api/docs`) is public for the MVP.
