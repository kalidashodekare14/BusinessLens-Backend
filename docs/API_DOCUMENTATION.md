# BusinessLens Backend — API Documentation

**Base URL:** `http://localhost:3000/api/v1` (configurable via `PORT`)  
**Auth:** JWT access token (15 min) in `Authorization: Bearer <token>`. Refresh token is an httpOnly cookie `bl_refresh` scoped to `/api/v1/auth`.  
**Envelope:** Success `{ "data": ..., "meta": { ... } }`. Lists include `meta: { page, pageSize, total }`.  
**Errors:** `{ "error": { "code": "...", "message": "...", "details": [...] } }`.  
**Money:** strings. **Timestamps:** ISO 8601 UTC. **IDs:** UUID v4.

---

## 0. Conventions

### 0.1 Common enums

- `MembershipRole`: `OWNER` | `MEMBER`
- `ImportType`: `ORDERS` | `PRODUCTS`
- `ImportStatus`: `UPLOADED` | `MAPPED` | `PROCESSING` | `COMPLETED` | `FAILED`
- `AnalysisStatus`: `QUEUED` | `RUNNING` | `COMPLETED` | `FAILED`
- `FindingType`: `REVENUE_DROP` | `ORDER_COUNT_DROP` | `PRODUCT_REVENUE_DROP`
- `Severity`: `MEDIUM` | `HIGH`
- `FindingStatus`: `OPEN` | `INVESTIGATING` | `RESOLVED`
- `AiStatus`: `PENDING` | `GENERATING` | `COMPLETED` | `FAILED`
- `CheckStatus`: `ok` | `down`

### 0.2 Canonical CSV fields (strict schema)

The mapping endpoint keys are **canonical fields** (the system's contract). The values are **actual CSV column headers** from `detectedHeaders`. Unknown keys are rejected with `is not a field for <type> imports`.

**ORDERS canonical keys:**

| Key | Type | Required | Source column synonyms |
| --- | --- | --- | --- |
| `orderId` | `text` (max 128) | yes | order id, orderid, order number, order no, id |
| `orderedAt` | `date` (ISO 8601 or YYYY-MM-DD) | yes | ordered at, order date, date, created at, ordered on, timestamp |
| `status` | `status` (default `completed`) | no | status, order status |
| `productName` | `text` (max 200) | yes | product name, product, item name, item, description |
| `sku` | `text` (max 100) | no | sku, product sku, item sku |
| `quantity` | `positiveInteger` | yes | quantity, qty, units, count |
| `unitPrice` | `money` (non-negative, ≤2 decimals) | yes | unit price, price, unit cost, item price |

**PRODUCTS canonical keys:**

| Key | Type | Required | Source column synonyms |
| --- | --- | --- | --- |
| `name` | `text` (max 200) | yes | name, product name, product, title |
| `sku` | `text` (max 100) | no | sku, product sku, item sku |
| `price` | `money` (non-negative, ≤2 decimals) | no | price, unit price, list price |

**Excluded order statuses** (stored but excluded from all metrics): `cancelled`, `refunded`, `voided` (case-insensitive).

### 0.3 Standard error codes

`400 VALIDATION_FAILED`, `401 UNAUTHORIZED`/`REFRESH_TOKEN_INVALID`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 IMPORT_NOT_MAPPABLE`/`IMPORT_NOT_CONFIRMABLE`/`CONFLICT`/`INVALID_TRANSITION`, `422 INVALID_CSV_FILE`/`IMPORT_FILE_INVALID`/`IMPORT_FILE_UNAVAILABLE`/`NO_ORDER_DATA`/`UNPROCESSABLE`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`/`DEMO_DATA_UNAVAILABLE`, `503 IMPORT_QUEUE_UNAVAILABLE`/`ANALYSIS_QUEUE_UNAVAILABLE`/`EXPLANATION_QUEUE_UNAVAILABLE`.

Error envelope shape:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": [
      {
        "field": "fieldName",
        "constraint": "rule",
        "message": "detail"
      }
    ]
  }
}
```

### 0.4 Pagination

Default `page=1`, default `pageSize=20`, max `pageSize=100`.

### 0.5 Health error 503

`GET /health` returns `200` with `status: ok` when both DB and Redis are up; `503` with `status: degraded` otherwise. Body stays in the data envelope.

---

## 1. Health

### 1.1 GET /health

- **Purpose:** Liveness/readiness probe checking DB and Redis.
- **Auth:** Public
- **Headers:** none
- **Path params:** none
- **Query params:** none
- **Success 200:**
```json
{
  "data": {
    "status": "ok",
    "checks": {
      "database": "ok",
      "redis": "ok"
    },
    "timestamp": "2026-10-30T07:20:55.000Z"
  },
  "meta": {}
}
```
- **Error 503:**
```json
{
  "data": {
    "status": "degraded",
    "checks": {
      "database": "ok",
      "redis": "down"
    },
    "timestamp": "2026-10-30T07:20:55.000Z"
  },
  "meta": {}
}
```

---

## 2. Auth

### 2.1 POST /auth/register

- **Purpose:** Create a user account.
- **Auth:** Public (rate limited)
- **Headers:** `Content-Type: application/json`
- **Request body:**
```json
{
  "email": "owner@example.com",
  "password": "correct horse battery staple",
  "name": "Avery Owner"
}
```
  - `email` (string, email format, required, max 254)
  - `password` (string, min 10, max 128, required)
  - `name` (string, 1-120 chars, required, trimmed)
- **Success 201:** (sets `bl_refresh` httpOnly cookie)
```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "owner@example.com",
    "name": "Avery Owner",
    "createdAt": "2026-10-30T07:20:55.000Z",
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  },
  "meta": {}
}
```
- **Errors:** `400 VALIDATION_FAILED`, `409 CONFLICT` (generic, does not confirm email existence), `429 RATE_LIMITED`.

### 2.2 POST /auth/login

- **Purpose:** Authenticate and issue tokens.
- **Auth:** Public (rate limited)
- **Headers:** `Content-Type: application/json`
- **Request body:**
```json
{
  "email": "owner@example.com",
  "password": "correct horse battery staple"
}
```
  - `email` (string, email format, required)
  - `password` (string, min 1, max 128, required)
- **Success 200:** (sets `bl_refresh` httpOnly cookie)
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  },
  "meta": {}
}
```
- **Errors:** `401 INVALID_CREDENTIALS` (same message for unknown email and wrong password), `429 RATE_LIMITED`.

### 2.3 POST /auth/refresh

- **Purpose:** Rotate refresh token and issue new access token.
- **Auth:** Public (cookie)
- **Headers:** Cookie `bl_refresh`
- **Request body:** none
- **Success 200:** (rotates cookie)
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  },
  "meta": {}
}
```
- **Errors:** `401 REFRESH_TOKEN_INVALID` (invalid/expired/reused token; cookie cleared). Reuse revokes the user's active tokens.

### 2.4 POST /auth/logout

- **Purpose:** Revoke refresh token.
- **Auth:** Public (cookie)
- **Headers:** Cookie `bl_refresh`
- **Request body:** none
- **Success 204:** No content (cookie cleared)
- **Errors:** none

---

## 3. Users

### 3.1 GET /users/me

- **Purpose:** Current user profile + organizations.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`
- **Success 200:**
```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "owner@example.com",
    "name": "Avery Owner",
    "organizations": [
      {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "name": "Acme Co",
        "role": "OWNER",
        "currency": "USD",
        "timezone": "UTC"
      }
    ]
  },
  "meta": {}
}
```

### 3.2 PATCH /users/me

- **Purpose:** Update profile name.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Request body:**
```json
{
  "name": "Avery Owner Updated"
}
```
  - `name` (string, 1-120 chars, required, trimmed)
- **Success 200:**
```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "owner@example.com",
    "name": "Avery Owner Updated"
  },
  "meta": {}
}
```
- **Errors:** `400 VALIDATION_FAILED`.

### 3.3 POST /users/me/change-password

- **Purpose:** Change password; revokes all refresh tokens.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Request body:**
```json
{
  "currentPassword": "old-password-123",
  "newPassword": "new-password-456"
}
```
  - `currentPassword` (string, min 1, max 128, required)
  - `newPassword` (string, min 10, max 128, required)
- **Success 204:** No content (cookie cleared)
- **Errors:** `400 INVALID_CURRENT_PASSWORD` (wrong current password), `404 NOT_FOUND`.

---

## 4. Organizations

### 4.1 POST /organizations

- **Purpose:** Create org + OWNER membership.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Request body:**
```json
{
  "name": "Acme Co"
}
```
  - `name` (string, 1-120 chars, required, trimmed)
- **Success 201:**
```json
{
  "data": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "name": "Acme Co",
    "role": "OWNER",
    "currency": "USD",
    "timezone": "UTC",
    "createdAt": "2026-10-30T07:20:55.000Z"
  },
  "meta": {}
}
```
- **Errors:** `400 VALIDATION_FAILED`.

### 4.2 GET /organizations

- **Purpose:** List caller's organizations.
- **Auth:** Bearer
- **Headers:** `Authorization: Bearer {{token}}`
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:**
```json
{
  "data": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "name": "Acme Co",
      "role": "OWNER",
      "currency": "USD",
      "timezone": "UTC"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

### 4.3 GET /organizations/:organizationId

- **Purpose:** Get org details.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "name": "Acme Co",
    "currency": "USD",
    "timezone": "UTC",
    "createdAt": "2026-10-30T07:20:55.000Z",
    "updatedAt": "2026-10-30T07:20:55.000Z"
  },
  "meta": {}
}
```
- **Errors:** `404 NOT_FOUND`.

### 4.4 PATCH /organizations/:organizationId

- **Purpose:** Update org name.
- **Auth:** Bearer + OWNER
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Path:** `organizationId` (uuid)
- **Request body:**
```json
{
  "name": "Acme Corp"
}
```
  - `name` (string, 1-120 chars, required, trimmed)
- **Success 200:**
```json
{
  "data": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "name": "Acme Corp",
    "currency": "USD",
    "timezone": "UTC",
    "createdAt": "2026-10-30T07:20:55.000Z",
    "updatedAt": "2026-10-30T08:00:00.000Z"
  },
  "meta": {}
}
```
- **Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`.

---

## 5. Catalog

### 5.1 GET /organizations/:organizationId/products

- **Purpose:** Paginated products.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:**
```json
{
  "data": [
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "name": "Widget A",
      "sku": "WID-A",
      "price": "19.99",
      "createdAt": "2026-10-30T07:20:55.000Z",
      "updatedAt": "2026-10-30T07:20:55.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

### 5.2 GET /organizations/:organizationId/orders

- **Purpose:** Paginated orders, filterable by date range.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20), `from` (ISO date, optional), `to` (ISO date, optional)
- **Success 200:**
```json
{
  "data": [
    {
      "id": "d4e5f6a7-b8c9-0123-defa-234567890123",
      "externalId": "ORD-001",
      "orderedAt": "2026-10-15T10:30:00.000Z",
      "status": "completed",
      "total": "59.97",
      "itemCount": 1
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```
- **Errors:** `400 VALIDATION_FAILED` when `from` is after `to`.

---

## 6. Imports

### 6.1 POST /organizations/:organizationId/imports

- **Purpose:** Upload CSV, detect headers, suggest mapping.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: multipart/form-data`
- **Path:** `organizationId` (uuid)
- **Form fields:**
  - `file` (file, `.csv`, ≤5 MB, UTF-8, required)
  - `type` (enum `ORDERS` | `PRODUCTS`, required)
- **Success 201:**
```json
{
  "data": {
    "id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
    "status": "UPLOADED",
    "type": "ORDERS",
    "originalFileName": "orders.csv",
    "detectedHeaders": [
      "order_id",
      "ordered_at",
      "product_name",
      "quantity",
      "unit_price"
    ],
    "suggestedMapping": {
      "orderId": "order_id",
      "orderedAt": "ordered_at",
      "productName": "product_name",
      "quantity": "quantity",
      "unitPrice": "unit_price",
      "status": null,
      "sku": null
    }
  },
  "meta": {}
}
```
- **Errors:** `400 VALIDATION_FAILED` (bad file/type/size), `422 INVALID_CSV_FILE` (non-CSV, binary, empty, >5MB).

### 6.2 GET /organizations/:organizationId/imports

- **Purpose:** List imports.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:**
```json
{
  "data": [
    {
      "id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
      "type": "ORDERS",
      "status": "COMPLETED",
      "originalFileName": "orders.csv",
      "totalRows": 5000,
      "processedRows": 4980,
      "failedRows": 20,
      "createdAt": "2026-10-30T07:20:55.000Z",
      "completedAt": "2026-10-30T07:25:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

### 6.3 GET /organizations/:organizationId/imports/:importId

- **Purpose:** Import detail.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `importId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
    "type": "ORDERS",
    "status": "PROCESSING",
    "originalFileName": "orders.csv",
    "detectedHeaders": [
      "order_id",
      "ordered_at",
      "product_name",
      "quantity",
      "unit_price"
    ],
    "columnMapping": {
      "orderId": "order_id",
      "orderedAt": "ordered_at",
      "productName": "product_name",
      "quantity": "quantity",
      "unitPrice": "unit_price"
    },
    "totalRows": 5000,
    "processedRows": 2500,
    "failedRows": 5,
    "createdAt": "2026-10-30T07:20:55.000Z",
    "completedAt": null
  },
  "meta": {}
}
```
- **Errors:** `404 NOT_FOUND`.

### 6.4 PUT /organizations/:organizationId/imports/:importId/mapping

- **Purpose:** Save column mapping, return 20-row preview with per-row errors.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Path:** `organizationId` (uuid), `importId` (uuid)
- **Request body:**
```json
{
  "mapping": {
    "orderId": "order_id",
    "orderedAt": "ordered_at",
    "status": "status",
    "productName": "product_name",
    "sku": "sku",
    "quantity": "quantity",
    "unitPrice": "unit_price"
  }
}
```
  - `mapping` (object, required): maps **canonical field keys** → **detected CSV header strings** or `null`.
  - Canonical keys for `ORDERS`: `orderId`, `orderedAt`, `status`, `productName`, `sku`, `quantity`, `unitPrice`.
  - Canonical keys for `PRODUCTS`: `name`, `sku`, `price`.
  - Required: `orderId`, `orderedAt`, `productName`, `quantity`, `unitPrice` (ORDERS); `name` (PRODUCTS).
  - Optional fields may be omitted or set to `null`.
  - Two canonical fields may not share one column header.
  - Unmapped CSV columns are ignored (no custom-metadata storage in MVP).
- **Success 200:**
```json
{
  "data": {
    "id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
    "type": "ORDERS",
    "status": "MAPPED",
    "detectedHeaders": [
      "order_id",
      "ordered_at",
      "product_name",
      "quantity",
      "unit_price"
    ],
    "mapping": {
      "orderId": "order_id",
      "orderedAt": "ordered_at",
      "productName": "product_name",
      "quantity": "quantity",
      "unitPrice": "unit_price"
    },
    "preview": {
      "rows": [
        {
          "rowNumber": 1,
          "values": {
            "orderId": "ORD-001",
            "orderedAt": "2026-10-15",
            "productName": "Widget A",
            "quantity": "3",
            "unitPrice": "19.99",
            "status": null,
            "sku": null
          },
          "valid": true,
          "errors": []
        }
      ],
      "truncated": false
    }
  },
  "meta": {}
}
```
- **Errors:** `400 VALIDATION_FAILED` (missing required, unknown canonical key, value not a detected header, duplicate column), `404 NOT_FOUND`, `409 IMPORT_NOT_MAPPABLE` (status not UPLOADED/MAPPED), `409 IMPORT_FILE_UNAVAILABLE`.

### 6.5 POST /organizations/:organizationId/imports/:importId/confirm

- **Purpose:** Enqueue processing.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `importId` (uuid)
- **Request body:** none
- **Success 202:**
```json
{
  "data": {
    "id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
    "type": "ORDERS",
    "status": "PROCESSING"
  },
  "meta": {}
}
```
- **Errors:** `404 NOT_FOUND`, `409 IMPORT_NOT_CONFIRMABLE` (status not MAPPED), `503 IMPORT_QUEUE_UNAVAILABLE`.

### 6.6 GET /organizations/:organizationId/imports/:importId/errors

- **Purpose:** Paginated error report (capped at 1000 entries).
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `importId` (uuid)
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:**
```json
{
  "data": [
    {
      "rowNumber": 5,
      "field": "quantity",
      "reason": "must be a positive integer"
    },
    {
      "rowNumber": 12,
      "field": "unitPrice",
      "reason": "must be a non-negative amount with at most 2 decimal places"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 20
  }
}
```

---

## 7. Analysis

### 7.1 POST /organizations/:organizationId/analysis-runs

- **Purpose:** Create and enqueue analysis run.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Request body:** none
- **Success 202:**
```json
{
  "data": {
    "id": "a7b8c9d0-e1f2-3456-abcd-567890123456",
    "status": "QUEUED",
    "createdAt": "2026-10-30T07:20:55.000Z"
  },
  "meta": {}
}
```
- **Errors:** `422 UNPROCESSABLE` (no orders available), `503 ANALYSIS_QUEUE_UNAVAILABLE`.

### 7.2 GET /organizations/:organizationId/analysis-runs

- **Purpose:** List runs.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:**
```json
{
  "data": [
    {
      "id": "a7b8c9d0-e1f2-3456-abcd-567890123456",
      "status": "COMPLETED",
      "referenceDate": "2026-10-29T00:00:00.000Z",
      "currentStart": "2026-09-30T00:00:00.000Z",
      "currentEnd": "2026-10-29T00:00:00.000Z",
      "previousStart": "2026-08-31T00:00:00.000Z",
      "previousEnd": "2026-09-29T00:00:00.000Z",
      "errorMessage": null,
      "createdAt": "2026-10-30T07:20:55.000Z",
      "completedAt": "2026-10-30T07:21:10.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

### 7.3 GET /organizations/:organizationId/analysis-runs/:analysisRunId

- **Purpose:** Run detail with periods, metrics, status.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `analysisRunId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "id": "a7b8c9d0-e1f2-3456-abcd-567890123456",
    "status": "COMPLETED",
    "referenceDate": "2026-10-29T00:00:00.000Z",
    "currentStart": "2026-09-30T00:00:00.000Z",
    "currentEnd": "2026-10-29T00:00:00.000Z",
    "previousStart": "2026-08-31T00:00:00.000Z",
    "previousEnd": "2026-09-29T00:00:00.000Z",
    "metricsSnapshot": {
      "version": 1,
      "referenceDate": "2026-10-29T00:00:00.000Z",
      "current": {
        "start": "2026-09-30T00:00:00.000Z",
        "end": "2026-10-29T00:00:00.000Z",
        "revenue": "12345.67",
        "orderCount": 45,
        "averageOrderValue": "274.35",
        "products": [
          {
            "productId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
            "name": "Widget A",
            "revenue": "5000.00",
            "units": 100
          }
        ]
      },
      "previous": {
        "start": "2026-08-31T00:00:00.000Z",
        "end": "2026-09-29T00:00:00.000Z",
        "revenue": "15000.00",
        "orderCount": 60,
        "averageOrderValue": "250.00",
        "products": [
          {
            "productId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
            "name": "Widget A",
            "revenue": "6000.00",
            "units": 120
          }
        ]
      }
    },
    "errorMessage": null,
    "createdAt": "2026-10-30T07:20:55.000Z",
    "completedAt": "2026-10-30T07:21:10.000Z"
  },
  "meta": {}
}
```
- **Errors:** `404 NOT_FOUND`.

---

## 8. Findings

### 8.1 GET /organizations/:organizationId/findings

- **Purpose:** List findings with filters.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Query:** `status` (enum `OPEN`|`INVESTIGATING`|`RESOLVED`, optional), `severity` (enum `MEDIUM`|`HIGH`, optional), `type` (enum `REVENUE_DROP`|`ORDER_COUNT_DROP`|`PRODUCT_REVENUE_DROP`, optional), `analysisRunId` (uuid, optional), `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:** (newest first)
```json
{
  "data": [
    {
      "id": "b8c9d0e1-f2a3-4567-bcde-678901234567",
      "analysisRunId": "a7b8c9d0-e1f2-3456-abcd-567890123456",
      "type": "REVENUE_DROP",
      "severity": "HIGH",
      "status": "OPEN",
      "title": "Revenue dropped 17.7%",
      "subjectKey": null,
      "createdAt": "2026-10-30T07:21:10.000Z",
      "resolvedAt": null
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

### 8.2 GET /organizations/:organizationId/findings/:findingId

- **Purpose:** Finding detail with evidence, explanation, notes.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `findingId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "id": "b8c9d0e1-f2a3-4567-bcde-678901234567",
    "analysisRunId": "a7b8c9d0-e1f2-3456-abcd-567890123456",
    "type": "REVENUE_DROP",
    "severity": "HIGH",
    "status": "OPEN",
    "title": "Revenue dropped 17.7%",
    "subjectKey": null,
    "ruleVersion": "1.0",
    "evidence": {
      "metric": "revenue",
      "current": {
        "value": "12345.67",
        "start": "2026-09-30",
        "end": "2026-10-29"
      },
      "previous": {
        "value": "15000.00",
        "start": "2026-08-31",
        "end": "2026-09-29"
      },
      "changePercent": -17.7,
      "thresholds": {
        "medium": -10,
        "high": -20
      },
      "relatedMetrics": {
        "orders": {
          "current": 45,
          "previous": 60
        },
        "aov": {
          "current": "274.35",
          "previous": "250.00"
        }
      }
    },
    "explanation": {
      "status": "COMPLETED",
      "model": "gemini-2.0-flash",
      "content": {
        "summary": "Revenue fell 17.7% compared to the previous 30 days.",
        "observedFacts": [
          "Revenue dropped from 15000.00 to 12345.67"
        ],
        "associatedSignals": [
          "Order count fell from 60 to 45"
        ],
        "possibleExplanations": [
          "Fewer orders or lower prices"
        ],
        "investigationSteps": [
          "Check top products"
        ],
        "uncertainty": "Cause not verified"
      },
      "validationPassed": true,
      "errorMessage": null,
      "attempts": 1,
      "updatedAt": "2026-10-30T07:22:00.000Z"
    },
    "notes": [
      {
        "id": "d0e1f2a3-b4c5-6789-defa-890123456789",
        "body": "Looking into this",
        "authorId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "createdAt": "2026-10-30T07:30:00.000Z"
      }
    ],
    "createdAt": "2026-10-30T07:21:10.000Z",
    "updatedAt": "2026-10-30T07:21:10.000Z",
    "resolvedAt": null
  },
  "meta": {}
}
```
- **Errors:** `404 NOT_FOUND`.

### 8.3 PATCH /organizations/:organizationId/findings/:findingId/status

- **Purpose:** Transition finding status.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Path:** `organizationId` (uuid), `findingId` (uuid)
- **Request body:**
```json
{
  "status": "INVESTIGATING"
}
```
  - `status` (enum `OPEN` | `INVESTIGATING` | `RESOLVED`, required)
  - Allowed transitions: `OPEN`→`INVESTIGATING`, `INVESTIGATING`→`RESOLVED`, `RESOLVED`→`OPEN` (reopen). No-op transitions rejected.
  - Setting `RESOLVED` sets `resolvedAt`; reopening clears it.
- **Success 200:**
```json
{
  "data": {
    "id": "b8c9d0e1-f2a3-4567-bcde-678901234567",
    "status": "INVESTIGATING",
    "resolvedAt": null,
    "updatedAt": "2026-10-30T07:31:00.000Z"
  },
  "meta": {}
}
```
- **Errors:** `404 NOT_FOUND`, `409 INVALID_TRANSITION` (also code `FINDING_INVALID_TRANSITION` in some paths — treat any 409 as invalid transition).

### 8.4 POST /organizations/:organizationId/findings/:findingId/notes

- **Purpose:** Add note.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: application/json`
- **Path:** `organizationId` (uuid), `findingId` (uuid)
- **Request body:**
```json
{
  "body": "Looking into this"
}
```
  - `body` (string, 1-2000 chars, required)
- **Success 201:**
```json
{
  "data": {
    "id": "d0e1f2a3-b4c5-6789-defa-890123456789",
    "body": "Looking into this",
    "authorId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "createdAt": "2026-10-30T07:30:00.000Z"
  },
  "meta": {}
}
```
- **Errors:** `400 VALIDATION_FAILED`, `404 NOT_FOUND`.

### 8.5 DELETE /organizations/:organizationId/findings/:findingId/notes/:noteId

- **Purpose:** Delete own note.
- **Auth:** Bearer + member (author only)
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `findingId` (uuid), `noteId` (uuid)
- **Success 204:** No content
- **Errors:** `403 FORBIDDEN` (not author), `404 NOT_FOUND`.

### 8.6 POST /organizations/:organizationId/findings/:findingId/explanation

- **Purpose:** Regenerate AI explanation (re-queues generation).
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `findingId` (uuid)
- **Request body:** none
- **Success 202:**
```json
{
  "data": {
    "id": "c9d0e1f2-a3b4-5678-cdef-789012345678",
    "findingId": "b8c9d0e1-f2a3-4567-bcde-678901234567",
    "status": "PENDING",
    "attempts": 0,
    "updatedAt": "2026-10-30T07:32:00.000Z"
  },
  "meta": {}
}
```
- **Errors:** `404 NOT_FOUND`, `503 EXPLANATION_QUEUE_UNAVAILABLE`.

---

## 9. Metrics & Dashboard

### 9.1 GET /organizations/:organizationId/metrics/overview

- **Purpose:** Key metrics overview (current vs previous 30-day periods).
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "referenceDate": "2026-10-29T00:00:00.000Z",
    "current": {
      "start": "2026-09-30T00:00:00.000Z",
      "end": "2026-10-29T00:00:00.000Z",
      "revenue": "12345.67",
      "orderCount": 45,
      "averageOrderValue": "274.35",
      "products": [
        {
          "productId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
          "name": "Widget A",
          "revenue": "5000.00",
          "units": 100
        }
      ]
    },
    "previous": {
      "start": "2026-08-31T00:00:00.000Z",
      "end": "2026-09-29T00:00:00.000Z",
      "revenue": "15000.00",
      "orderCount": 60,
      "averageOrderValue": "250.00",
      "products": [
        {
          "productId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
          "name": "Widget A",
          "revenue": "6000.00",
          "units": 120
        }
      ]
    },
    "changes": {
      "revenue": -17.7,
      "orderCount": -25.0,
      "averageOrderValue": 9.7
    }
  },
  "meta": {}
}
```
- **Errors:** `422 NO_ORDER_DATA` (no non-excluded orders).

### 9.2 GET /organizations/:organizationId/dashboard

- **Purpose:** Counts by severity, latest run, key metrics.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "openFindings": {
      "total": 3,
      "bySeverity": {
        "MEDIUM": 2,
        "HIGH": 1
      }
    },
    "latestAnalysisRun": {
      "id": "a7b8c9d0-e1f2-3456-abcd-567890123456",
      "status": "COMPLETED",
      "referenceDate": "2026-10-29T00:00:00.000Z",
      "createdAt": "2026-10-30T07:20:55.000Z",
      "completedAt": "2026-10-30T07:21:10.000Z"
    },
    "metrics": {
      "referenceDate": "2026-10-29T00:00:00.000Z",
      "revenue": {
        "current": "12345.67",
        "previous": "15000.00",
        "changePercent": -17.7
      },
      "orderCount": {
        "current": 45,
        "previous": 60,
        "changePercent": -25.0
      },
      "averageOrderValue": {
        "current": "274.35",
        "previous": "250.00",
        "changePercent": 9.7
      }
    }
  },
  "meta": {}
}
```

---

## 10. Audit & Demo (OWNER only)

### 10.1 GET /organizations/:organizationId/audit-logs

- **Purpose:** Paginated audit trail.
- **Auth:** Bearer + OWNER
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Query:** `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:**
```json
{
  "data": [
    {
      "id": "e1f2a3b4-c5d6-7890-efab-901234567890",
      "action": "organization.created",
      "actorId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "entityType": "Organization",
      "entityId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "metadata": {},
      "createdAt": "2026-10-30T07:20:55.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```
- **Errors:** `403 FORBIDDEN`.

### 10.2 POST /organizations/:organizationId/demo-data

- **Purpose:** Load sample dataset (queued via import pipeline).
- **Auth:** Bearer + OWNER
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Request body:** none
- **Success 202:**
```json
{
  "data": {
    "status": "PROCESSING",
    "imports": [
      {
        "id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
        "type": "PRODUCTS",
        "status": "PROCESSING"
      },
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567891",
        "type": "ORDERS",
        "status": "PROCESSING"
      }
    ]
  },
  "meta": {}
}
```
- **Errors:** `403 FORBIDDEN`, `500 DEMO_DATA_UNAVAILABLE`.

---

## Appendix A — CSV Import & Mapping Quick Reference

### A.1 Upload

```bash
curl -X POST {{baseUrl}}/organizations/{{orgId}}/imports \
  -H "Authorization: Bearer {{token}}" \
  -F "file=@orders.csv" \
  -F "type=ORDERS"
```

### A.2 Mapping (canonical keys → your CSV headers)

**ORDERS example:**
```json
{
  "mapping": {
    "orderId": "order_id",
    "orderedAt": "order_date",
    "status": "order_status",
    "productName": "product_name",
    "sku": "sku",
    "quantity": "qty",
    "unitPrice": "unit_price"
  }
}
```

**PRODUCTS example:**
```json
{
  "mapping": {
    "name": "product_name",
    "sku": "product_id",
    "price": "selling_price_bdt"
  }
}
```

> Keys are canonical (fixed). Values are your CSV headers (from `detectedHeaders`). Extra columns (`category`, `unit_cost_bdt`, `stock_quantity`, `reorder_level`) are **ignored** — the MVP Product schema only stores `name`, `sku`, `price`. Only `name` is required for PRODUCTS.

### A.3 Confirm

```bash
curl -X POST {{baseUrl}}/organizations/{{orgId}}/imports/{{importId}}/confirm \
  -H "Authorization: Bearer {{token}}"
```

### A.4 Poll

```bash
curl {{baseUrl}}/organizations/{{orgId}}/imports/{{importId}} \
  -H "Authorization: Bearer {{token}}"
```

---

## Appendix B — Number & Validation Rules

- Money is `Decimal` (strings in JSON). Never JS floats.
- Percentages rounded to 1 decimal for display, exact in calculation.
- Excluded statuses: `cancelled`, `refunded`, `voided` (case-insensitive).
- Analysis requires ≥20 previous orders; previous value zero → no percentage finding.
- Rule thresholds (boundary inclusive): `REVENUE_DROP`/`ORDER_COUNT_DROP` at ≤-10% (MEDIUM -10 to -20, HIGH below -20); `PRODUCT_REVENUE_DROP` for top 10 products at ≤-30% (MEDIUM -30 to -50, HIGH below -50).
- AI explanation numbers must match evidence values (validator rejects invented numbers).

---

## Appendix C — Cookie & CORS

- Cookie: `bl_refresh`, httpOnly, Path `/api/v1/auth`, Secure in production, SameSite Lax.
- CORS: only configured `CORS_ORIGIN`, `credentials: true`.
- Rate limiting on `/auth/*`.
