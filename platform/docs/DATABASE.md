# Backend and Database Implementation Guide

This guide describes the existing `platform/` backend. It is not a replacement for migrations or schema source files. Keep this document aligned with `prisma/schema.prisma`, tenant schema migration scripts, and [API.md](./API.md).

## 1. Backend stack

| Component | Current version/choice | Purpose |
|---|---|---|
| Node.js | 22 Alpine in Docker | Server runtime |
| Next.js | 16.4.5 from package manifest | App Router and API route handlers |
| TypeScript | 5.7.2 | Strict server/client code |
| PostgreSQL | 16 Alpine in Compose | Durable platform and tenant data |
| Prisma / Prisma Client | 5.22.0 | Typed SQL access and public-schema migrations |
| Zod | 4.6.7 | API input validation |
| bcryptjs | 2.4.3 | Password hashing |
| jose | 5.9.6 | Signed session tokens |

Use versions declared in `package.json`/lockfile; update this table when dependency versions change.

## 2. Schema model and tenant boundary

```mermaid
erDiagram
  Tenant ||--o{ TenantNode : monitors
  Tenant ||--o{ BusinessMembership : maps
  User ||--o{ PaymentTransaction : receives
  Invoice ||--o{ InvoiceItem : contains
  Invoice ||--o{ PaymentTransaction : records
  Invoice ||--|| LedgerEntry : snapshots
  Customer ||--o{ Invoice : referenced_by
  Product ||--o{ InvoiceItem : referenced_by
  Product ||--o{ StockMovement : changes
  Quotation ||--o{ QuotationItem : contains
  Vendor ||--o{ PurchaseOrder : receives
  PurchaseOrder ||--o{ PurchaseOrderItem : contains
```

`Tenant`, `TenantNode`, and membership/operator metadata live in the public schema. Each tenant has a generated PostgreSQL schema containing business records. Many tenant tables are initialized via provisioning and `src/server/platform-schema.ts`; not all are Prisma models in the public `schema.prisma`.

### Public schema (Prisma)

| Table/model | Key fields | Purpose/relationship |
|---|---|---|
| `Tenant` | UUID id, encrypted name/legal/GSTIN/UPI/logo fields, unique slug/schemaName/apiKeyHash, enabled/maintenance flags, locale/currency/timezone, plan/trial/limits, backup metadata | Tenant directory and operational configuration |
| `TenantNode` | UUID id, tenantId, nodeId, version/platform/device, lastHeartbeat, session/storage/transaction counters | Tenant device telemetry; unique `(tenantId,nodeId)` |
| `BusinessMembership` | See Prisma model/migrations | Maps user to tenant and membership role |

### Core tenant schema

| Table | Important fields and types | Rules |
|---|---|---|
| `User` | UUID id, username unique, encrypted displayName, bcrypt `passwordHash`, role, theme/currency/locale, optional customerId, createdAt, disabledAt | Password hash only; role/status rechecked each request |
| `Product` | UUID id, name, SKU unique, unit, `DECIMAL(12,2)` price, `DECIMAL(12,3)` stock/lowStockAt, `DECIMAL(5,2)` GST rate, HSN, updatedAt | Inventory writes guarded/locked |
| `Customer` | UUID id, encrypted name/phone/email/GSTIN/state/address as configured, stateCode, createdAt | PII decrypt only at authorized response boundary |
| `Invoice` | UUID id, unique number, optional customerId, encrypted customer/seller snapshots, status, `DECIMAL(14,2)` totals/paid, payment status, tax/state fields, createdBy, issuedAt | Immutable issued financial snapshot |
| `InvoiceItem` | UUID id, invoiceId FK, optional productId, name/HSN snapshot, quantity `DECIMAL(12,3)`, price/tax/total `DECIMAL(14,2)` | Cascades with invoice; preserve historical item values |
| `PaymentTransaction` | UUID id, invoiceId FK, amount `DECIMAL(14,2)`, encrypted method/attribution as applicable, receivedAt, legacy-snapshot flag | Append payment event and update invoice balance atomically |
| `LedgerEntry` | UUID id, unique invoiceId FK, number/date, encrypted customer/item snapshots, tax and total decimal | One ledger snapshot per invoice |
| `AuditLog` | actorId, action, subject, JSONB details, createdAt | Append-only through application workflows; exclude sensitive payloads |

### Tenant extension tables

Provisioning/schema initialization currently defines or evolves tables including:

- Auth/admin: `UserPermission`.
- Inventory: `ProductVariant`, `StockMovement`, `Warehouse`, `WarehouseStock`, `WarehouseTransfer`, `WarehouseTransferItem`.
- Sales: `Quotation`, `QuotationItem`, `BillingSchedule`, `BillingMilestone`, `SalesDocument`, `SalesDocumentItem`, `DocumentConversion`, `CreditDebitNote`, `CreditDebitNoteItem`.
- Tax/pricing: `DiscountTier`, `TaxRule`, `CurrencyRate`, `RateCard`, `RateCardItem`.
- Purchasing/CRM: `Vendor`, `PurchaseOrder`, `PurchaseOrderItem`, `CrmInteraction`, `Expense`.
- Operations: `Notification`, `BackupRecord`, `IntegrationConnection`, `DocumentTemplate`, `DocumentAccess`, `PartyLedgerEntry`, `PaymentReminder`, `EInvoiceRecord`, `EWayBillRecord`, `AgentTask`, `AgentProfile`, `AgentErrorReport`, and migration tracking.

Use the source DDL in `src/server/platform-schema.ts`, provisioning code, and migration scripts for exact columns and constraints. Every new tenant feature must be added to both fresh provisioning and upgrade paths.

## 3. Indexing and performance

Existing indexes include unique identifiers, invoice/payment date lookup, ledger date, task status/date, movement product/date, schedule status/next run, notifications user/read/date, and several module-specific foreign-key/access patterns.

Before adding an index:

1. Identify the exact API query and expected tenant data volume.
2. Inspect PostgreSQL query plan with `EXPLAIN (ANALYZE, BUFFERS)` on representative staging data.
3. Add a migration or idempotent tenant upgrade statement and an index supporting the filter/order prefix.
4. Measure write cost, table/index size, and latency after rollout.

Avoid leading-wildcard text scans on large tables, loading full invoice histories for search, and adding indexes to every column. Paginate histories using stable cursor order (timestamp plus unique ID) before they exceed bounded limits.

## 4. Migrations

### Public schema

1. Update `prisma/schema.prisma`.
2. Generate migration in development with `npx prisma migrate dev --name descriptive_change`.
3. Review SQL for safe ordering, locks, default values, and data backfill.
4. Test migration from an empty database and a copy of the prior schema.
5. Apply in deployment with `npm run db:deploy` or the deploy image flow.

### Tenant schemas

Tenant tables are not fully represented by Prisma Migrate. Update all relevant paths:

1. Fresh schema DDL in `src/server/provision.ts`.
2. Versioned tenant migration script (see `scripts/migrate-tenants.js` and tenant migration registry).
3. Idempotent extension initialization in `src/server/platform-schema.ts` if applicable.
4. Test fresh provisioning and upgrade from every supported prior migration state.
5. Verify rollback/recovery strategy; do not assume public Prisma migration can roll back tenant DDL.

Commands from `platform/`:

```powershell
npm ci
npx prisma generate
npx prisma migrate dev --name descriptive_change
npm run db:deploy
npm test
npm run lint
```

Never run development migration commands against production.

## 5. Seed and demo data

Provisioning currently creates clearly named demo products and a sample customer for a new tenant. Before production billing, provide an explicit, reviewed process to replace/remove only confirmed demo records. Do not run broad deletes or treat real records as seed data. Tests should create isolated synthetic tenants and clean them transactionally or destroy only the dedicated test database.

## 6. Backend folder structure and modules

```text
src/app/api/             HTTP handlers: auth, validation, authorization, response
src/server/auth.ts       Session, role, permission helpers
src/server/db.ts         Public and tenant Prisma clients
src/server/provision.ts  Tenant schema/account bootstrap
src/server/platform-schema.ts  Tenant extension DDL
src/server/field-encryption.ts PII encryption/decryption helpers
src/server/subscription.ts     Plan/feature gates
src/server/http.ts       JSON parsing and safe error helpers
src/gst.ts               Tax arithmetic and validation helpers
src/server/ledger.ts     Ledger/export snapshots
scripts/                 Provision, tenant migration, deployment utilities
prisma/                  Public models and migrations
tests/                   Node test-runner coverage
```

Route handlers should be thin. Core functions should accept explicit typed values, avoid HTTP globals, and be unit-testable. Keep authorization at route boundaries and transaction invariants in domain/data logic.

## 7. Backend feature data flows

- **Provisioning:** validate operator secret and Zod input; generate schema; create tables/user/hash/API-key hash; insert tenant/membership; create demo records; return one-time API key. Roll back schema on failure.
- **Login:** resolve tenant slug; enforce bounded attempts; compare bcrypt hash; construct signed cookie; return current role/effective permissions.
- **Invoice:** load tenant catalog and business snapshot; lock product rows; calculate decimal-safe totals/tax; insert invoice/items/initial payment/ledger; decrement stock; commit once.
- **Payment:** validate amount/method; lock invoice; reject overpayment; insert payment event and atomically recalculate status/balance; audit.
- **Uploads:** bound request bytes, validate format/size, decode/resize where needed, encrypt sensitive payload, return authorized metadata.
- **Provider integration:** load tenant/provider config; validate configured HTTPS endpoint; timeout; validate response schema; never return secret or raw exception.

## 8. Validation, sanitization, and errors

- Validate body, path, and query parameters with Zod; enforce maximum byte and item counts before expensive parsing.
- Normalize slugs/usernames and known codes; do not silently sanitize financial amounts into different values.
- Use parameterized Prisma/raw SQL. Dynamic SQL identifiers must be generated and strictly validated; values must be bound parameters.
- Return stable client errors without stack traces or SQL. Keep detailed diagnostic context in access-controlled logs only.
- Do not log request/response bodies, auth headers, secrets, customer PII, or payment instrument data.
- Distinguish invalid input, unauthenticated, forbidden, missing, conflict, rate-limit, provider unavailable, and internal errors.

## 9. Caching, queues, pagination, scale

- PostgreSQL is the source of truth. No Redis cache or durable queue currently exists.
- Do not cache balances, inventory, or authorization decisions across writes.
- Keep database results bounded. Use cursor pagination with stable ordering for large invoice/customer histories.
- `tenantDb` caches one Prisma client per active tenant schema; calculate aggregate connections across replicas before scaling horizontally.
- Move process-local login/API limits to a shared store before multiple app replicas.
- Add queue/workers only for async work such as large exports/notifications; use idempotency, bounded retries, and dead-letter monitoring.

## 10. Configuration and local development

Required server configuration: `DATABASE_URL`, `JWT_SECRET` (at least 32 random bytes), `PROVISIONING_SECRET` (at least 32 random bytes), and `DATA_ENCRYPTION_KEY` (exactly 32 random bytes encoded as required by the helper). Deployment also needs database bootstrap values and `DOMAIN`. See [SETUP.md](./SETUP.md) and never commit real credentials.

From `platform/`:

```powershell
npm ci
$env:DATABASE_URL = "postgresql://app:local-only-password@localhost:5432/namma_bill?schema=public"
$env:JWT_SECRET = "<32-or-more-random-bytes-for-local-development>"
$env:PROVISIONING_SECRET = "<different-32-or-more-random-bytes>"
$env:DATA_ENCRYPTION_KEY = "<valid-32-byte-key-encoding>"
npx prisma generate
npm run db:deploy
npm run dev
```

Run tests without production secrets. Database integration tests require a dedicated disposable test DB and migration setup. Confirm actual env parsing/key encoding in `field-encryption.ts` before using a sample value.

## 11. Backend testing checklist

- Fresh and upgrade tenant migrations both succeed.
- Tenant A cannot read/write tenant B by changing IDs, slugs, or request fields.
- Role/permission denial happens at the server API, not only in the UI.
- Concurrent checkout cannot oversell; payment cannot exceed balance.
- Tax rounding, discount allocation, and ledger snapshots match fixtures.
- Invalid/oversized JSON and file payloads fail safely.
- Provider timeout/invalid response produces a bounded, safe error.
- Backup restore retains tenants, encryption key availability, and core workflows.

Detailed endpoint contracts: [API.md](./API.md). Test/QA plan: [TESTING.md](./TESTING.md).
