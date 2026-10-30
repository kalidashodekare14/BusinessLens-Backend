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
{
  "data": {
    "status": "ok",
    "db": "ok",
    "redis": "ok"
  },
  "meta": {}
}
```
- **Error 503:**
```json
{
  "data": {
    "status": "degraded",
    "db": "ok",
    "redis": "down"
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
- **Success 201:**
```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "owner@example.com",
    "name": "Avery Owner",
    "createdAt": "2026-10-30T07:20:55.000Z"
  },
  "meta": {}
}
```
- **Errors:**
  - 400 `VALIDATION_FAILED`:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [
      {
        "field": "password",
        "constraint": "minLength",
        "message": "password must be at least 10 characters"
      }
    ]
  }
}
```
  - 409 `EMAIL_TAKEN`:
```json
{
  "error": {
    "code": "EMAIL_TAKEN",
    "message": "Unable to register",
    "details": []
  }
}
```
  - 429 `RATE_LIMITED`:
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": []
  }
}
```

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
- **Errors:**
  - 401 `INVALID_CREDENTIALS`:
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "details": []
  }
}
```
  - 429 `RATE_LIMITED`:
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": []
  }
}
```

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
- **Errors:**
  - 401 `UNAUTHORIZED` (invalid/expired/reused token; cookie cleared):
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid refresh token",
    "details": []
  }
}
```

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
- **Errors:**
  - 400 `VALIDATION_FAILED`:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": []
  }
}
```

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
- **Errors:**
  - 400 `VALIDATION_FAILED` (wrong current password):
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Current password is incorrect",
    "details": []
  }
}
```

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
- **Errors:**
  - 400 `VALIDATION_FAILED`:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": []
  }
}
```

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
- **Errors:**
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Organization not found",
    "details": []
  }
}
```

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
- **Errors:**
  - 403 `FORBIDDEN`:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient role",
    "details": []
  }
}
```
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Organization not found",
    "details": []
  }
}
```

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
      "items": [
        {
          "id": "e5f6a7b8-c9d0-1234-efab-345678901234",
          "productName": "Widget A",
          "quantity": 3,
          "unitPrice": "19.99",
          "lineTotal": "59.97"
        }
      ]
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

## 6. Imports

### 6.1 POST /organizations/:organizationId/imports

- **Purpose:** Upload CSV, detect headers, suggest mapping.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`, `Content-Type: multipart/form-data`
- **Path:** `organizationId` (uuid)
- **Form fields:**
  - `file` (file, .csv, <=5MB, required)
  - `type` (string, `ORDERS` or `PRODUCTS`, required)
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
- **Errors:**
  - 400 `VALIDATION_FAILED` (bad file/type/size):
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "File must be a CSV under 5MB",
    "details": []
  }
}
```

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
- **Errors:**
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Import job not found",
    "details": []
  }
}
```

### 6.4 PUT /organizations/:organizationId/imports/:importId/mapping

- **Purpose:** Save column mapping, return 20-row preview with errors.
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
  - `mapping` (object, required): maps canonical fields to CSV header names or null
  - Required canonical fields: `orderId`, `orderedAt`, `productName`, `quantity`, `unitPrice` (for ORDERS); `name` (for PRODUCTS)
- **Success 200:**
```json
{
  "data": {
    "mapping": {
      "orderId": "order_id",
      "orderedAt": "ordered_at",
      "productName": "product_name",
      "quantity": "quantity",
      "unitPrice": "unit_price"
    },
    "preview": [
      {
        "rowNumber": 2,
        "data": {
          "orderId": "ORD-001",
          "orderedAt": "2026-10-15",
          "productName": "Widget A",
          "quantity": 3,
          "unitPrice": "19.99"
        },
        "errors": []
      }
    ],
    "rowErrors": [
      {
        "rowNumber": 5,
        "field": "quantity",
        "reason": "must be a positive integer"
      }
    ]
  },
  "meta": {}
}
```
- **Errors:**
  - 400 `VALIDATION_FAILED` (missing required fields):
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Missing required field mapping: orderId",
    "details": []
  }
}
```

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
    "status": "PROCESSING"
  },
  "meta": {}
}
```
- **Errors:**
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Import job not found",
    "details": []
  }
}
```
  - 409 `CONFLICT` (already processing/completed):
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Import already confirmed",
    "details": []
  }
}
```

### 6.6 GET /organizations/:organizationId/imports/:importId/errors

- **Purpose:** Paginated error report.
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
      "reason": "must be a non-negative decimal"
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
- **Errors:**
  - 422 `UNPROCESSABLE` (no orders):
```json
{
  "error": {
    "code": "UNPROCESSABLE",
    "message": "No orders found for analysis",
    "details": []
  }
}
```

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
      "current": {
        "revenue": "12345.67",
        "orders": 45,
        "aov": "274.35"
      },
      "previous": {
        "revenue": "15000.00",
        "orders": 60,
        "aov": "250.00"
      }
    },
    "errorMessage": null,
    "createdAt": "2026-10-30T07:20:55.000Z",
    "completedAt": "2026-10-30T07:21:10.000Z"
  },
  "meta": {}
}
```
- **Errors:**
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Analysis run not found",
    "details": []
  }
}
```

---

## 8. Findings

### 8.1 GET /organizations/:organizationId/findings

- **Purpose:** List findings with filters.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Query:** `status` (OPEN|INVESTIGATING|RESOLVED, optional), `severity` (MEDIUM|HIGH, optional), `type` (REVENUE_DROP|ORDER_COUNT_DROP|PRODUCT_REVENUE_DROP, optional), `analysisRunId` (uuid, optional), `page` (int, default 1), `pageSize` (int, 1-100, default 20)
- **Success 200:** (newest first)
```json
{
  "data": [
    {
      "id": "b8c9d0e1-f2a3-4567-bcde-678901234567",
      "type": "REVENUE_DROP",
      "severity": "HIGH",
      "status": "OPEN",
      "title": "Revenue dropped 17.7%",
      "subjectKey": null,
      "ruleVersion": "1.0",
      "createdAt": "2026-10-30T07:21:10.000Z",
      "updatedAt": "2026-10-30T07:21:10.000Z",
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
      "id": "c9d0e1f2-a3b4-5678-cdef-789012345678",
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
      "validationPassed": true
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
- **Errors:**
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Finding not found",
    "details": []
  }
}
```

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
  - `status` (enum: OPEN, INVESTIGATING, RESOLVED, required)
  - Allowed transitions: OPEN→INVESTIGATING, INVESTIGATING→RESOLVED, RESOLVED→OPEN
- **Success 200:**
```json
{
  "data": {
    "status": "INVESTIGATING",
    "resolvedAt": null
  },
  "meta": {}
}
```
  - Setting RESOLVED sets `resolvedAt`; reopening clears it.
- **Errors:**
  - 409 `FINDING_INVALID_TRANSITION`:
```json
{
  "error": {
    "code": "FINDING_INVALID_TRANSITION",
    "message": "Cannot transition from OPEN to RESOLVED",
    "details": []
  }
}
```
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Finding not found",
    "details": []
  }
}
```

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
- **Errors:**
  - 400 `VALIDATION_FAILED`:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": []
  }
}
```
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Finding not found",
    "details": []
  }
}
```

### 8.5 DELETE /organizations/:organizationId/findings/:findingId/notes/:noteId

- **Purpose:** Delete own note.
- **Auth:** Bearer + member (author only)
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `findingId` (uuid), `noteId` (uuid)
- **Success 204:** No content
- **Errors:**
  - 403 `FORBIDDEN` (not author):
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Not the note author",
    "details": []
  }
}
```
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Note not found",
    "details": []
  }
}
```

### 8.6 POST /organizations/:organizationId/findings/:findingId/explanation

- **Purpose:** Regenerate AI explanation.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid), `findingId` (uuid)
- **Request body:** none
- **Success 202:**
```json
{
  "data": {
    "status": "PENDING"
  },
  "meta": {}
}
```
- **Errors:**
  - 404 `NOT_FOUND`:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Finding not found",
    "details": []
  }
}
```

---

## 9. Metrics & Dashboard

### 9.1 GET /organizations/:organizationId/metrics/overview

- **Purpose:** Key metrics overview.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "referenceDate": "2026-10-29T00:00:00.000Z",
    "current": {
      "revenue": "12345.67",
      "orders": 45,
      "aov": "274.35"
    },
    "previous": {
      "revenue": "15000.00",
      "orders": 60,
      "aov": "250.00"
    },
    "changePercent": {
      "revenue": -17.7,
      "orders": -25.0,
      "aov": 9.7
    }
  },
  "meta": {}
}
```

### 9.2 GET /organizations/:organizationId/dashboard

- **Purpose:** Counts by severity, latest run, key metrics.
- **Auth:** Bearer + member
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Success 200:**
```json
{
  "data": {
    "findings": {
      "open": {
        "medium": 2,
        "high": 1
      },
      "investigating": 0,
      "resolved": 3
    },
    "latestAnalysisRun": {
      "id": "a7b8c9d0-e1f2-3456-abcd-567890123456",
      "status": "COMPLETED",
      "createdAt": "2026-10-30T07:20:55.000Z"
    },
    "keyMetrics": {
      "revenue": "12345.67",
      "orders": 45,
      "aov": "274.35"
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
- **Errors:**
  - 403 `FORBIDDEN`:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient role",
    "details": []
  }
}
```

### 10.2 POST /organizations/:organizationId/demo-data

- **Purpose:** Load sample dataset (queued).
- **Auth:** Bearer + OWNER
- **Headers:** `Authorization: Bearer {{token}}`
- **Path:** `organizationId` (uuid)
- **Request body:** none
- **Success 202:**
```json
{
  "data": {
    "status": "QUEUED"
  },
  "meta": {}
}
```
- **Errors:**
  - 403 `FORBIDDEN`:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient role",
    "details": []
  }
}
```

---

## Standard Error Codes

400 `VALIDATION_FAILED`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 422 `UNPROCESSABLE`, 429 `RATE_LIMITED`, 500 `INTERNAL_ERROR`.

Error envelope:
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
