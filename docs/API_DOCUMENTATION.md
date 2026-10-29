# BusinessLens Backend API Documentation

Base URL: `http://localhost:3000/api/v1` (configurable via `PORT`). All responses use the envelope `{ "data": ..., "meta": { ... } }`. Errors: `{ "error": { "code", "message", "details" } }`. Money values are strings; timestamps ISO 8601 UTC.

Authentication: JWT access token (15 min) in `Authorization: Bearer <token>`. Refresh token in httpOnly cookie `bl_refresh` scoped to `/api/v1/auth`.

## Health

### GET /health
- Purpose: liveness/readiness (DB + Redis)
- Auth: none
- Success 200: `{ data: { status, db, redis }, meta: {} }` (503 if unhealthy)

## Auth

### POST /auth/register
- Body: `{ email, password, name }`
- Success 201: `{ data: { id, email, name }, meta }`
- Errors: 400 validation, 409 duplicate email

### POST /auth/login
- Body: `{ email, password }`
- Success 200: `{ data: { accessToken, expiresIn }, meta }` + sets `bl_refresh` cookie
- Errors: 401 invalid credentials

### POST /auth/refresh
- Cookie: `bl_refresh`
- Success 200: `{ data: { accessToken, expiresIn }, meta }` (rotates cookie)
- Errors: 401

### POST /auth/logout
- Cookie: `bl_refresh`
- Success 204

## Users

### GET /users/me
- Auth: Bearer
- Success 200: `{ data: { id, email, name, organizations: [...] } }`

### PATCH /users/me
- Body: `{ name }`
- Success 200: user view

### POST /users/me/change-password
- Body: `{ currentPassword, newPassword }`
- Success 204 (revokes refresh tokens, clears cookie)

## Organizations

### POST /organizations
- Body: `{ name }`
- Success 201: organization view (creator OWNER)

### GET /organizations
- Query: page, pageSize
- Success 200: paginated list

### GET /organizations/:organizationId
- Auth: member
- Success 200: organization view

### PATCH /organizations/:organizationId
- Auth: OWNER
- Body: `{ name }`
- Success 200

## Catalog

### GET /organizations/:organizationId/products
- Query: page, pageSize
- Success 200: paginated products

### GET /organizations/:organizationId/orders
- Query: page, pageSize, from, to (ISO dates)
- Success 200: paginated orders

## Imports

### POST /organizations/:organizationId/imports
- Multipart: file (csv, <=5MB), type (ORDERS|PRODUCTS)
- Success 201: `{ data: { id, status, detectedHeaders, suggestedMapping } }`

### GET /organizations/:organizationId/imports
- Query: page, pageSize
- Success 200: paginated

### GET /organizations/:organizationId/imports/:importId
- Success 200: import detail

### PUT /organizations/:organizationId/imports/:importId/mapping
- Body: `{ mapping: { canonicalField: header|null } }`
- Success 200: preview (first 20 rows + errors)

### POST /organizations/:organizationId/imports/:importId/confirm
- Success 202: `{ status: PROCESSING }`

### GET /organizations/:organizationId/imports/:importId/errors
- Query: page, pageSize
- Success 200: paginated errors

## Analysis

### POST /organizations/:organizationId/analysis-runs
- Success 202: `{ data: { id, status: QUEUED } }`

### GET /organizations/:organizationId/analysis-runs
- Query: page, pageSize
- Success 200: paginated

### GET /organizations/:organizationId/analysis-runs/:analysisRunId
- Success 200: run detail (periods, metricsSnapshot, status)

## Findings

### GET /organizations/:organizationId/findings
- Query: status, severity, type, analysisRunId, page, pageSize
- Success 200: paginated findings (newest first)

### GET /organizations/:organizationId/findings/:findingId
- Success 200: finding detail (evidence, explanation, notes)

### PATCH /organizations/:organizationId/findings/:findingId/status
- Body: `{ status }` (OPEN|INVESTIGATING|RESOLVED)
- Success 200: `{ status, resolvedAt }`
- Errors: 409 invalid transition

### POST /organizations/:organizationId/findings/:findingId/notes
- Body: `{ body }`
- Success 201: note view

### DELETE /organizations/:organizationId/findings/:findingId/notes/:noteId
- Success 204 (author only)

### POST /organizations/:organizationId/findings/:findingId/explanation
- Success 202: queued view

## Metrics

### GET /organizations/:organizationId/metrics/overview
- Success 200: metrics overview

## Dashboard

### GET /organizations/:organizationId/dashboard
- Success 200: counts by severity, latest run, key metrics

## Audit (OWNER only)

### GET /organizations/:organizationId/audit-logs
- Query: page, pageSize
- Success 200: paginated audit logs

## Demo (OWNER only)

### POST /organizations/:organizationId/demo-data
- Success 202: queued import

## Error codes

Standard HTTP: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict, 422, 429 rate limit, 500. Error body `{ error: { code, message, details } }`.
