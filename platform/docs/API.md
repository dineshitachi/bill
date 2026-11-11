# API Specification — darkworld.website

This document inventories the current `platform/src/app/api` surface. It describes the implemented route families; the route handlers and Zod schemas remain authoritative for exact field names. There is no public cross-origin API guarantee or inbound payment webhook today.

## 1. Base URL and versioning

- Production base: `https://darkworld.website/api`
- Local development: `http://localhost:3000/api`
- Most endpoints are same-origin application APIs and are not independently versioned.
- Operator endpoints use `/api/v1/` (`provision`, `fleet`). Any future external integration contract should be explicitly versioned rather than silently changing these internal routes.
- JSON request/response is default unless an endpoint returns a file (XLSX, SVG, image).

## 2. Authentication and authorization

### Tenant session

Sign in with `POST /auth/login`. Success sets an HTTP-only, SameSite=Strict cookie, Secure in production. Send it automatically for same-origin requests. Do not copy the cookie to browser storage or scripts.

Roles: `ADMIN`, `SALES` (legacy `STAFF` normalized), `CUSTOMER`. Middleware applies coarse route-role checks; handlers perform session, permission, tenant, and object-level authorization. A customer portal request must be scoped to the logged-in customer's linked identity.

### Operator and device credentials

- `POST /v1/provision`: `x-provisioning-secret` operator secret; creates a tenant and reveals a generated tenant key once.
- `/v1/fleet`: `x-provisioning-secret` for operator metadata management.
- `POST /telemetry/heartbeat`: `x-tenant-key` for a tenant device heartbeat.

Never put these secrets in query strings or browser bundles.

## 3. Common response and error contract

Most successful JSON responses use named resource objects or collections. Most client errors use:

```json
{ "error": "A concise, user-safe explanation" }
```

Common statuses:

| Status | Meaning |
|---|---|
| 200 | Successful read/update/action |
| 201 | Created |
| 400 | Malformed or invalid input |
| 401 | No valid session or operator credential |
| 403 | Authenticated but not permitted |
| 404 | Resource unavailable/not found (avoid leaking cross-tenant existence) |
| 409 | Conflict, duplicate, or invalid state transition |
| 429 | Rate limited |
| 502/503 | External provider or required service unavailable |
| 500 | Unexpected internal failure; response must not expose internals |

Validation limits, enum values, and exact response projections are defined in each route's Zod schema and serializer. Never rely on client-side validation alone.

## 4. Endpoint inventory

`{id}`, `{provider}`, `{sku}` are path parameters. Unless noted, tenant endpoints require a session.

### Authentication, profile, and workspace

| Method | Path | Purpose / access |
|---|---|---|
| POST | `/auth/login` | Authenticate tenant slug, username, password; set session cookie |
| POST | `/auth/logout` | Clear session |
| GET | `/auth/me` | Current authenticated user/company/permissions |
| GET, PUT | `/profile` | Read/update current user profile |
| PUT | `/profile/theme` | Update appearance theme |
| GET, POST | `/businesses` | List/switch businesses for current user |
| GET, POST | `/onboarding` | Read/update onboarding state, subject to role/plan |
| GET, POST | `/subscription` | Read plan/trial and supported subscription actions |

### Dashboard, search, catalog, and customers

| Method | Path | Purpose / access |
|---|---|---|
| GET | `/dashboard` | Dashboard metrics and operational summaries |
| GET | `/search` | Search authorized invoice/customer/product data |
| GET, POST | `/products` | List/create catalog products; create is admin-only |
| PATCH, DELETE | `/products/{id}` | Update/delete product; mutations admin-only |
| GET, POST | `/customers` | List/create customer records |
| PATCH, DELETE | `/customers/{id}` | Update/delete customer; exact role enforced by handler |
| GET | `/customer-balances` | Authorized outstanding balances/payment summary |

### Invoices, payments, and inventory

| Method | Path | Purpose / access |
|---|---|---|
| GET, POST | `/invoices` | List invoices; create invoice with server-calculated tax and stock transaction |
| PATCH | `/invoices/{id}` | Record a supported invoice update/payment; issued financial facts remain immutable |
| GET | `/invoices/{id}/xlsx` | Download invoice workbook |
| GET | `/invoices/{id}/logo` | Authorized invoice logo preview |
| POST | `/inventory/batch` | Batch inventory update/receipt workflow |
| GET | `/inventory/movements` | Stock movement history |
| GET, POST | `/inventory/variants` | List/create product variants |
| PATCH, DELETE | `/inventory/variants/{id}` | Update/delete variant |
| GET, POST | `/warehouses` | List/create warehouse |
| POST | `/warehouses/stock` | Apply a warehouse stock operation |
| POST | `/warehouse-transfers` | Create warehouse transfer |
| POST | `/warehouse-transfers/{id}/receive` | Receive transfer |
| GET, POST | `/purchase-orders` | List/create purchase orders |
| PATCH, DELETE | `/purchase-orders/{id}` | Update/delete purchase order |
| POST | `/purchase-orders/{id}/receive` | Receive ordered stock |

### Quotations, sales documents, and billing schedules

| Method | Path | Purpose / access |
|---|---|---|
| GET, POST | `/quotations` | List/create quotation |
| GET, PATCH, DELETE | `/quotations/{id}` | Read/update/delete quotation |
| POST | `/quotations/{id}/convert` | Convert quotation into a sale/invoice workflow |
| GET, POST | `/sales-documents` | List/create supported sales documents |
| POST | `/documents/convert` | Convert supported source document |
| POST | `/documents/render` | Render configured document output |
| GET, POST | `/billing/schedules` | List/create recurring billing schedule |
| PATCH, DELETE | `/billing/schedules/{id}` | Update/delete schedule |
| POST | `/billing/schedules/{id}/run` | Execute an eligible schedule |
| GET, POST | `/billing/milestones` | List/create billing milestones |
| POST | `/billing/milestones/{id}/pay` | Record milestone payment |
| GET, POST | `/crm/interactions` | List/create customer interactions |
| PATCH, DELETE | `/crm/interactions/{id}` | Update/delete interaction |

### Customer portal

| Method | Path | Purpose / access |
|---|---|---|
| GET | `/portal/invoices` | Customer's own invoices |
| GET | `/portal/statements` | Customer's own statement |
| POST | `/portal/quotations/{id}/decision` | Accept/decline an eligible quotation |

### Accounting, tax, and reports

| Method | Path | Purpose / access |
|---|---|---|
| GET, POST | `/ledger/party` | Party ledger query/action |
| POST | `/ledger/reminders` | Create/open a payment reminder workflow |
| GET, POST | `/notes` | List/create credit/debit notes |
| POST | `/notes/{id}/post` | Post an eligible note |
| GET, POST | `/expenses` | List/create expenses |
| PATCH, DELETE | `/expenses/{id}` | Update/delete expense |
| GET, PUT | `/expenses/{id}/access` | Read/update protected expense document access |
| GET | `/expenses/{id}/attachment` | Authorized attachment download |
| GET | `/reports/financial` | Financial report |
| GET | `/reports/cash-flow-forecast` | Cash-flow forecast |
| POST | `/tax/calculate` | Calculate tax using configured rules |
| POST | `/gst/verify` | Verify GSTIN through an optional authorized provider; format checks alone are not verification |
| GET, POST | `/admin/tax-rules` | List/create tax rules (admin) |
| PATCH, DELETE | `/admin/tax-rules/{id}` | Update/delete tax rule (admin) |
| GET | `/admin/tax-report` | Tax report (admin) |
| GET | `/admin/gst-annual` | Annual GST workbook/export (admin) |
| GET | `/admin/compliance/export` | Compliance data export (admin) |
| GET, POST | `/admin/discount-tiers` | List/create discount tiers (admin) |
| GET | `/admin/ledger` | Tenant ledger export/read (admin) |

### Team, settings, documents, and integrations

| Method | Path | Purpose / access |
|---|---|---|
| GET, POST, DELETE | `/admin/users` | List/create/disable team users (admin) |
| GET, PUT | `/admin/permissions` | Read/update explicit permission grants (admin) |
| GET | `/admin/audit` | Read audit trail (admin) |
| GET, PUT | `/admin/company` | Read/update business settings (admin) |
| POST | `/admin/api-key` | Rotate tenant device API key (admin) |
| GET, POST, DELETE | `/admin/integrations` | List/create/delete integration configuration (admin) |
| POST | `/gateway/{provider}` | Bounded outbound integration request; authenticated tenant user |
| GET, POST | `/currency/rates` | Read/configure exchange rates |
| POST | `/currency/rates/sync` | Sync rates from configured provider |
| GET, PUT | `/settings/regional` | Read/update regional preferences |
| GET, POST | `/templates/gallery` | List/configure template gallery |
| POST | `/templates/render` | Render a template |
| GET, POST | `/agents` | List/create agent profiles |
| GET, POST | `/agent/tasks` | List/submit human-review task requests |
| PATCH | `/agent/tasks/{id}` | Review/update task, admin-gated per handler |
| GET | `/agent/tasks/{id}/screenshot` | Authorized screenshot retrieval |
| POST | `/agent/chat` | Optional AI assistant stream; requires configured provider |
| GET | `/notifications` | List current user's notifications |
| POST | `/notifications` | Create supported notification |
| PATCH | `/notifications/{id}` | Update/read state for own notification |
| GET | `/admin/backups` | List backups (admin) |
| POST | `/admin/backups` | Create backup/snapshot (admin) |
| GET | `/admin/backups/{id}` | Read/download a backup artifact (admin) |
| POST | `/admin/backups/{id}/restore` | Restore workflow (admin; operationally high risk) |
| GET, PATCH | `/admin/telemetry` | Read/update operational telemetry settings (admin) |
| GET, POST | `/admin/compliance/eway` | Read/create e-way provider workflow (admin) |
| POST | `/admin/compliance/einvoice` | Submit e-invoice provider workflow (admin) |
| GET, POST | `/pricing/rate-cards` | List/create rate cards |
| POST | `/pricing/resolve` | Resolve applicable price |
| GET, POST | `/vendors` | List/create vendors |
| PATCH, DELETE | `/vendors/{id}` | Update/delete vendor |
| GET | `/barcodes/sku/{sku}` | Return barcode representation for authorized SKU |

### Provisioning and telemetry

| Method | Path | Credential | Purpose |
|---|---|---|---|
| GET | `/health` | Public health probe | Database connectivity status |
| POST | `/v1/provision` | `x-provisioning-secret` | Create tenant; returns one-time tenant API key |
| GET, PATCH | `/v1/fleet` | `x-provisioning-secret` | View fleet metadata or update enabled/maintenance flags |
| POST | `/telemetry/heartbeat` | `x-tenant-key` | Upsert operational device heartbeat |
| POST | `/telemetry/errors` | Session/telemetry policy | Submit sanitized client diagnostic |

## 5. Important request formats

Exact field schemas vary by handler. Core examples:

### Sign in

```http
POST /api/auth/login
Content-Type: application/json

{"tenant":"business-slug","username":"owner","password":"<password>"}
```

Success sets the session cookie and returns user/company data and effective permissions. Invalid credentials return a generic 401; repeated attempts may return 429.

### Create invoice (shape summary)

```http
POST /api/invoices
Content-Type: application/json

{
  "customerId": "uuid",
  "placeOfSupplyStateCode": "33",
  "discount": 0,
  "amountPaid": 0,
  "paymentMethod": "",
  "items": [{"productId":"uuid","quantity":1}]
}
```

The server reads current product prices/tax, validates stock, computes tax/discount, and commits invoice, ledger, payment (if supplied), and stock update atomically. Never submit authoritative unit price/tax totals from the browser.

### Provision a tenant

```http
POST /api/v1/provision
x-provisioning-secret: <operator secret>
Content-Type: application/json

{
  "name":"Business name",
  "slug":"business-slug",
  "adminUsername":"owner",
  "adminDisplayName":"Business Owner",
  "adminPassword":"<unique password of at least 12 characters>"
}
```

Created response includes tenant metadata and a one-time `installation.apiKey`; store it securely and never log it.

## 6. Pagination, filtering, and sorting

Current handlers use endpoint-specific filters and bounded `take` values; there is not yet a consistent public cursor contract. Do not assume a `page`, `limit`, `cursor`, or sort parameter exists unless the route schema implements it. New list APIs should cap page size and use a stable cursor such as `(issuedAt,id)` with a matching index.

## 7. File upload/download

- Company logo is submitted as a validated PNG/JPEG/WebP data URL after client-side resize; server enforces encoded size and format.
- Agent task screenshot is an optional bounded PNG/JPEG/WebP data URL; retrieval is authenticated.
- Invoice logo preview is authorized.
- XLSX and compliance endpoints return generated files; preserve `Content-Disposition` and avoid caching private exports.
- Never accept executable content or trust client MIME alone.

## 8. Rate limiting

Nginx applies per-IP API request and connection limits. Login and selected integration/agent paths also have application-level limits, some process-local. Those local counters are not shared across replicas. Use a shared limiter before horizontal scaling and validate trusted proxy address handling.

## 9. External APIs and webhooks

Provider adapters are server-side, optional, and configured by protected environment variables or encrypted tenant integration records. Use HTTPS, timeouts, response validation, bounded payloads, and generic provider failure messages.

There is **no inbound payment webhook endpoint** in the current platform. Manual payment recording is not provider settlement. A future webhook must verify signatures against the raw body, be idempotent/replay-safe, validate invoice/amount/currency with the provider, and durably record event IDs before acknowledging.

## 10. API security requirements

- Use HTTPS; same-origin session cookie only.
- Validate all path/query/body inputs; limit request bytes and item counts.
- Apply handler-level role, permission, tenant, and object authorization.
- Keep operator secrets and provider credentials out of URL, browser bundle, response, and logs.
- Use parameterized SQL; validate any dynamic schema identifier.
- Avoid shared caching of authenticated or tenant responses.
- Use a separate test tenant and synthetic data for API/security tests.
