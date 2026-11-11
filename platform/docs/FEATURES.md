# Feature Development Guide — darkworld.website

This guide maps current product capabilities to implementation surfaces. Route schemas and Prisma/tenant migration code remain authoritative. Priorities follow [PLAN.md](./PLAN.md); the visual and interaction contract is in [DESIGN.md](./DESIGN.md).

## Development rules for every feature

1. Define role/tenant access, user journey, validation, success/error state, and acceptance tests.
2. Read the current handler, shared component, and schema before changing behavior.
3. Keep financial calculations server-authoritative and decimal-safe.
4. For data changes update Prisma/public migration and, when tenant data is involved, provisioning DDL plus tenant upgrade logic.
5. Add route-level authorization and object scoping; hiding a button is not access control.
6. Bound input bytes, array lengths, uploads, query counts, and provider timeouts.
7. Test success, empty, invalid, unauthorized, conflict, dependency failure, and responsive states.
8. Update API and related documentation when contract changes.

## Feature index

| Feature | Priority | Core UI/API |
|---|---|---|
| Workspace provisioning | P0 | `/api/v1/provision`, `/api/v1/fleet` |
| Sign-in and role permissions | P0 | `/api/auth/*`, `/api/admin/users`, `/api/admin/permissions` |
| Dashboard and search | P0 | `/api/dashboard`, `/api/search` |
| Product/customer management | P0 | `/api/products`, `/api/customers` |
| Inventory and stock | P0 | `/api/inventory/*`, `/api/warehouses`, `/api/purchase-orders` |
| Invoicing and payments | P0 | `/api/invoices`, `/api/customer-balances` |
| Print/export/accounting | P0/P1 | invoice export, `/api/admin/ledger`, `/api/reports/*` |
| Quotations and portal | P1 | `/api/quotations`, `/api/portal/*` |
| Admin/settings/audit | P0 | `/api/admin/*`, `/api/profile`, `/api/settings/regional` |
| Tax and compliance | P1/conditional | `/api/tax/*`, `/api/admin/compliance/*` |
| Optional AI assistant/task intake | P1/conditional | `/api/agent/*`, `/api/agents` |
| Integrations/notifications/backups | Conditional | `/api/admin/integrations`, `/api/notifications`, `/api/admin/backups` |

## 1. Workspace provisioning and tenant isolation (P0, High)

**Flow:** operator authenticates out-of-band → validates tenant/admin details → creates schema and initial admin → returns one-time key → admin signs in.

**Implementation:** `src/app/api/v1/provision/route.ts`, `src/server/provision.ts`, `src/server/db.ts`, tenant migration scripts. Keep schema identifiers generated and validated; roll back partial schema creation on failure.

**Tests:** invalid secret, duplicate slug/user, malformed data, schema creation failure cleanup, tenant A/B isolation, one-time key not stored in plaintext.

## 2. Authentication and permissions (P0, High)

**Flow:** sign-in → signed HTTP-only cookie → server rechecks current tenant/user/role for each request → sign-out clears cookie.

**Implementation:** `src/server/auth.ts`, `src/middleware.ts`, `/api/auth/*`, admin team and permission routes. Each handler must authorize action and resource scope.

**Tests:** unauthenticated/forbidden access, role changes, disabled users, tenant maintenance, cookie expiry, explicit permission overrides, customer portal ownership.

Reset-password, email verification, OAuth, and self-service registration are not established current features; do not present them as supported without approval and implementation.

## 3. Dashboard and global search (P0, Medium)

**Flow:** authenticated user opens dashboard → bounded metrics and links → search authorized records → navigates to the selected record.

**Implementation:** `src/app/api/dashboard/route.ts`, `/api/search`, dashboard/search components, shared store. Search must not fetch unbounded invoice/customer tables.

**Tests:** role-projected summaries, empty dataset, no-match, invalid query, tenant isolation, response latency with representative data.

## 4. Product and customer catalog (P0, Medium)

**Flow:** staff searches/selects item/customer; admin creates/edits catalog; staff customer-creation rights follow approved permissions.

**Implementation:** `/api/products`, `/api/customers`, their detail handlers, product/customer forms and table components; schemas are tenant-scoped.

**Tests:** duplicate SKU, price/stock bounds, encrypted PII serialization, permissions, concurrent updates, bounded search.

## 5. Inventory, purchasing, and warehouse (P0 core; advanced P1, High)

**Flow:** admin maintains product stock; staff checks available quantities; purchase receipt/transfer/adjustment updates stock with movement history.

**Implementation:** `/api/inventory/*`, `/api/warehouses/*`, `/api/warehouse-transfers`, `/api/purchase-orders`; `Product`, `ProductVariant`, `StockMovement`, warehouse tables and migration initializer.

**Tests:** stock movement before/after, negative stock rejection, lock contention, receiving quantity caps, cross-warehouse transfer atomicity, idempotent retry behavior.

## 6. Invoice creation and payment recording (P0, High)

**Flow:** choose customer and products → edit quantities/discount → server computes tax and verifies stock → review total/initial payment → commit → print or revisit.

**Implementation:** `/api/invoices` and detail route; `src/gst.ts`, ledger/encryption helpers, invoice preview, checkout state. Keep invoice, items, ledger, initial payment, and stock decrement in one transaction. Follow tax jurisdiction rules in approved configuration.

**Tests:** exact tax rounding; discount allocation; missing product; insufficient/concurrently depleted stock; transaction rollback; duplicate submission; partial/full/overpayment; payment history; immutable snapshot.

Online card processing, provider settlement, and webhook-driven payment confirmation are not implemented. Manual payment entry must be labeled honestly.

## 7. Invoice print, spreadsheet and accounting (P0/P1, Medium)

**Flow:** user opens invoice → sees stored snapshot and payment balance → prints or exports authorized record; admin runs ledger/accounting views.

**Implementation:** invoice detail, `/api/invoices/{id}/xlsx`, `/api/admin/ledger`, `/api/reports/financial`, `/api/admin/gst-annual`; Excel generation should be bounded and preserve authorization.

**Tests:** print width, omitted private fields, payment history consistency, export content, large-history bounds, failed download state.

## 8. Quotations and customer portal (P1, High)

**Flow:** staff prepares quotation → shares via approved method → linked customer sees own quotation and decides → staff converts eligible quotation.

**Implementation:** `/api/quotations`, detail/convert routes, `/api/portal/*`; version/state transitions prevent stale edits and customer ID must be verified server-side.

**Tests:** unauthorized quote ID, stale version, duplicate decision, expiry, conversion stock contention, portal cross-customer isolation.

## 9. Team, business settings, audit (P0, Medium)

**Flow:** admin updates company settings, creates/disables user, manages permissions, reviews audit history.

**Implementation:** `/api/admin/company`, `/api/admin/users`, `/api/admin/permissions`, `/api/admin/audit`, `src/server/auth.ts`, shared settings/team forms.

**Tests:** only admin can mutate; cannot remove final admin without approved recovery path; audit event is created; secrets/PII excluded from audit details; permission changes take effect on existing sessions.

## 10. Tax, GST and compliance (P1 / provider-dependent, High)

**Flow:** app calculates configured tax and optionally asks authorized provider to verify/submit data; UI distinguishes locally calculated from externally confirmed.

**Implementation:** `src/gst.ts`, `/api/tax/calculate`, `/api/gst/verify`, `/api/admin/compliance/*`, report/export components.

**Tests:** intra/interstate arithmetic; jurisdiction and rounding; provider timeout, malformed response and unavailable config; no false government-verification claims.

GST filing, statutory acceptance, IRN/e-way issuance are not guaranteed by local calculations or a configured adapter alone.

## 11. Optional AI assistant and human request inbox (P1/conditional, Medium)

**Flow:** user asks catalog question → server sends bounded permitted context → answer/draft suggestion is shown → user edits and explicitly checks out. Task intake is stored separately for human review.

**Implementation:** `/api/agent/chat`, `/api/agent/tasks`, task screenshot route, `src/agent-templates.ts`, UI assistant panel. No customer/invoice/payment records; no autonomous execution.

**Tests:** no-provider behavior, timeout, context boundary, prompt injection attempt, schema-invalid model output, upload constraints, and no model-driven mutation.

## 12. Integrations, notification and backup (Conditional, High for recovery)

**Flow:** admin configures authorized provider → secret encrypted/server-side → bounded request → safe result and audited setting. Backup workflow requires restore safety.

**Implementation:** `/api/admin/integrations`, `/api/gateway/{provider}`, `/api/notifications`, `/api/admin/backups`; provider adapters and encrypted fields.

**Tests:** SSRF/path traversal, HTTPS-only targets, timeout, rate limit, secret redaction, backup isolation/checksum, explicit restore confirmation. Email/SMS and gateway webhooks require separate product decisions.

## Cross-feature acceptance checklist

- [ ] Correct owner/role/tenant can use it; all other roles are denied server-side.
- [ ] Resource IDs cannot cross tenant/customer boundaries.
- [ ] Input and response are bounded, validated, and do not expose secrets/PII.
- [ ] Data mutations preserve transaction and audit invariants.
- [ ] Loading, empty, validation, conflict, offline, timeout, and server error states are usable.
- [ ] Mobile and keyboard navigation work.
- [ ] Focused tests pass; docs/API inventory reflect the shipped contract.
