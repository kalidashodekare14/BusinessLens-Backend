# BusinessLens Backend — API Documentation

**Base URL:** `http://localhost:3000/api/v1` (configurable via `PORT`)  
**Auth:** JWT access token (15 min) in `Authorization: Bearer <token>`. Refresh token is an httpOnly cookie `bl_refresh` scoped to `/api/v1/auth`.  
**Envelope:** Success `{ "data": ..., "meta": { ... } }`. Lists include `meta: { page, pageSize, total }`.  
**Errors:** `{ "error": { "code": "...", "message": "...", "details": [...] } }`.  
**Money:** strings. **Timestamps:** ISO 8601 UTC. **IDs:** UUID v4.

---

## 1. Health

### 1.1 GET /health
- **Purpose:** Liveness/readiness probe checking DB and Redis.
- **Auth:** Public
- **Headers:** none
- **Success 200:**
```json
{ "data": { "status": "ok", "db": "ok", "redis": "ok" }, "meta": {} }
```
- **Error 503:** `{ "data": { "status": "degraded", "db": "ok", "redis": "down" }, "meta": {} }`

---

## 2. Auth

### 2.1 POST /auth/register
- **Purpose:** Create a user account.
- **Auth:** Public (rate limited)
- **Headers:** `Content-Type: application/json`
- **Body:** `{ email (email, required), password (string, min 10, max 128, required), name (string, 1-120, required) }`
- **Example:**
```json
{ "email": "owner@example.com", "password": "correct horse battery staple", "name": "Avery Owner" }
```
- **Success 201:** `{ "data": { "id": "uuid", "email": "owner@example.com", "name": "Avery Owner" }, "meta": {} }`
- **Errors:** 400 validation; 409 `{ "error": { "code": "EMAIL_TAKEN", "message": "Unable to register", "details": [] } }`

### 2.2 POST /auth/login
- **Purpose:** Authenticate and issue tokens.
- **Auth:** Public (rate limited)
- **Headers:** `Content-Type: application/json`
- **Body:** `{ email (required), password (required) }`
- **Success 200:** `{ "data": { "accessToken": "jwt", "expiresIn": 900 }, "meta": {} }` + sets `bl_refresh` cookie
- **Errors:** 401 `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password", "details": [] } }`

### 2.3 POST /auth/refresh
- **Purpose:** Rotate refresh token and issue new access token.
- **Auth:** Public (cookie)
- **Headers:** Cookie `bl_refresh`
- **Success 200:** `{ "data": { "accessToken": "jwt", "expiresIn": 900 }, "meta": {} }`
- **Errors:** 401 (invalid/expired/reused token; cookie cleared)

### 2.4 POST /auth/logout
- **Purpose:** Revoke refresh token.
- **Auth:** Public (cookie)
- **Success 204:** No content

---

## 3. Users

### 3.1 GET /users/me
- **Purpose:** Current user profile + organizations.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`
- **Success 200:** `{ "data": { "id": "uuid", "email": "...", "name": "...", "organizations": [{ "id": "uuid", "name": "...", "role": "OWNER" }] }, "meta": {} }`

### 3.2 PATCH /users/me
- **Purpose:** Update profile name.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Body:** `{ name (string, 1-120, required) }`
- **Success 200:** user view

### 3.3 POST /users/me/change-password
- **Purpose:** Change password; revokes all refresh tokens.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Body:** `{ currentPassword (required), newPassword (string, min 10, required) }`
- **Success 204:** No content (cookie cleared)
- **Errors:** 400 (wrong current password)

---

## 4. Organizations

### 4.1 POST /organizations
- **Purpose:** Create org + OWNER membership.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Body:** `{ name (string, 1-120, required) }`
- **Success 201:** `{ "data": { "id": "uuid", "name": "...", "role": "OWNER", "currency": "USD", "timezone": "UTC" }, "meta": {} }`

### 4.2 GET /organizations
- **Purpose:** List caller's organizations.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:** paginated

### 4.3 GET /organizations/:organizationId
- **Purpose:** Get org details.
- **Auth:** Bearer + member
- **Path:** `organizationId` (uuid)
- **Success 200:** org view
- **Errors:** 404 if not member

### 4.4 PATCH /organizations/:organizationId
- **Purpose:** Update org name.
- **Auth:** Bearer + OWNER
- **Path:** `organizationId` (uuid)
- **Body:** `{ name (string, 1-120, required) }`
- **Success 200:** updated org
- **Errors:** 403 (non-owner), 404

---

## 5. Catalog

### 5.1 GET /organizations/:organizationId/products
- **Purpose:** Paginated products.
- **Auth:** Bearer + member
- **Query:** `page`, `pageSize`
- **Success 200:** `{ "data": [...], "meta": { "page", "pageSize", "total" } }`

### 5.2 GET /organizations/:organizationId/orders
- **Purpose:** Paginated orders, filterable by date range.
- **Auth:** Bearer + member
- **Query:** `page`, `pageSize`, `from` (ISO date), `to` (ISO date)
- **Success 200:** paginated orders

---

## 6. Imports

### 6.1 POST /organizations/:organizationId/imports
- **Purpose:** Upload CSV, detect headers, suggest mapping.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: multipart/form-data`
- **Form:** `file` (csv, <=5MB), `type` (ORDERS|PRODUCTS)
- **Success 201:** `{ "data": { "id": "uuid", "status": "UPLOADED", "detectedHeaders": [...], "suggestedMapping": {...} }, "meta": {} }`
- **Errors:** 400 (bad file/type/size)

### 6.2 GET /organizations/:organizationId/imports
- **Purpose:** List imports.
- **Auth:** Bearer + member
- **Query:** `page`, `pageSize`
- **Success 200:** paginated

### 6.3 GET /organizations/:organizationId/imports/:importId
- **Purpose:** Import detail.
- **Auth:** Bearer + member
- **Path:** `importId` (uuid)
- **Success 200:** import detail
- **Errors:** 404

### 6.4 PUT /organizations/:organizationId/imports/:importId/mapping
- **Purpose:** Save column mapping, return 20-row preview with errors.
- **Auth:** Bearer + member
- **Body:** `{ mapping: { canonicalField: header|null } }`
- **Success 200:** `{ "data": { "mapping": {...}, "preview": [...], "rowErrors": [...] }, "meta": {} }`
- **Errors:** 400 (missing required fields)

### 6.5 POST /organizations/:organizationId/imports/:importId/confirm
- **Purpose:** Enqueue processing.
- **Auth:** Bearer + member
- **Success 202:** `{ "data": { "id": "uuid", "status": "PROCESSING" }, "meta": {} }`

### 6.6 GET /organizations/:organizationId/imports/:importId/errors
- **Purpose:** Paginated error report.
- **Auth:** Bearer + member
- **Query:** `page`, `pageSize`
- **Success 200:** paginated errors

---

## 7. Analysis

### 7.1 POST /organizations/:organizationId/analysis-runs
- **Purpose:** Create and enqueue analysis run.
- **Auth:** Bearer + member
- **Success 202:** `{ "data": { "id": "uuid", "status": "QUEUED" }, "meta": {} }`

### 7.2 GET /organizations/:organizationId/analysis-runs
- **Purpose:** List runs.
- **Auth:** Bearer + member
- **Query:** `page`, `pageSize`
- **Success 200:** paginated

### 7.3 GET /organizations/:organizationId/analysis-runs/:analysisRunId
- **Purpose:** Run detail with periods, metrics, status.
- **Auth:** Bearer + member
- **Path:** `analysisRunId` (uuid)
- **Success 200:** run detail
- **Errors:** 404

---

## 8. Findings

### 8.1 GET /organizations/:organizationId/findings
- **Purpose:** List findings with filters.
- **Auth:** Bearer + member
- **Query:** `status` (OPEN|INVESTIGATING|RESOLVED), `severity` (MEDIUM|HIGH), `type` (REVENUE_DROP|ORDER_COUNT_DROP|PRODUCT_REVENUE_DROP), `analysisRunId` (uuid), `page`, `pageSize`
- **Success 200:** paginated findings (newest first)

### 8.2 GET /organizations/:organizationId/findings/:findingId
- **Purpose:** Finding detail with evidence, explanation, notes.
- **Auth:** Bearer + member
- **Path:** `findingId` (uuid)
- **Success 200:** finding detail
- **Errors:** 404

### 8.3 PATCH /organizations/:organizationId/findings/:findingId/status
- **Purpose:** Transition finding status.
- **Auth:** Bearer + member
- **Body:** `{ status: OPEN|INVESTIGATING|RESOLVED }`
- **Success 200:** `{ "data": { "status": "...", "resolvedAt": "..." }, "meta": {} }`
- **Errors:** 409 `{ "error": { "code": "FINDING_INVALID_TRANSITION", "message": "...", "details": [] } }`

### 8.4 POST /organizations/:organizationId/findings/:findingId/notes
- **Purpose:** Add note.
- **Auth:** Bearer + member
- **Body:** `{ body (string, 1-2000, required) }`
- **Success 201:** note view

### 8.5 DELETE /organizations/:organizationId/findings/:findingId/notes/:noteId
- **Purpose:** Delete own note.
- **Auth:** Bearer + member (author only)
- **Success 204**
- **Errors:** 403 (not author), 404

### 8.6 POST /organizations/:organizationId/findings/:findingId/explanation
- **Purpose:** Regenerate AI explanation.
- **Auth:** Bearer + member
- **Success 202:** `{ "data": { "status": "PENDING" }, "meta": {} }`

---

## 9. Metrics & Dashboard

### 9.1 GET /organizations/:organizationId/metrics/overview
- **Purpose:** Key metrics overview.
- **Auth:** Bearer + member
- **Success 200:** metrics overview

### 9.2 GET /organizations/:organizationId/dashboard
- **Purpose:** Counts by severity, latest run, key metrics.
- **Auth:** Bearer + member
- **Success 200:** dashboard view

---

## 10. Audit & Demo (OWNER only)

### 10.1 GET /organizations/:organizationId/audit-logs
- **Purpose:** Paginated audit trail.
- **Auth:** Bearer + OWNER
- **Query:** `page`, `pageSize`
- **Success 200:** paginated
- **Errors:** 403 (non-owner)

### 10.2 POST /organizations/:organizationId/demo-data
- **Purpose:** Load sample dataset (queued).
- **Auth:** Bearer + OWNER
- **Success 202:** `{ "data": { "status": "QUEUED" }, "meta": {} }`
- **Errors:** 403

---

## Standard Error Codes
400 VALIDATION_FAILED, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT, 422 UNPROCESSABLE, 429 RATE_LIMITED, 500 INTERNAL_ERROR.
