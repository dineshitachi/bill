# Bill My Book: UI and architecture specification

## Product shell

The application is a tenant-scoped Next.js app. The client shell owns transient workflow state (current view, bill draft, quotation draft, modal state, filters, and toast messages); the server owns durable business state in Prisma/PostgreSQL. Every API handler resolves the signed tenant session before reading or mutating data.

The canonical client routes are represented by the `view` query parameter:

| View | Purpose | Staff | Admin |
| --- | --- | :---: | :---: |
| `dashboard` | Business pulse, low-stock alerts, recent invoices | ✓ | ✓ |
| `billing` | Create a GST bill and record initial payment | ✓ | ✓ |
| `invoices` | Search, filter, preview, and print invoices | ✓ | ✓ |
| `inventory` / `low-stock` | Catalog lookup; admin CRUD | Read | CRUD |
| `quotation` | Price-list quotation draft and bill hand-off | ✓ | ✓ |
| `customers` | Search and customer CRUD; financial balances are admin-only | CRUD | CRUD |
| `payments` | Outstanding balances and payment transactions | — | ✓ |
| `team` / `settings` / `compliance` / `audit` | Tenant administration | — | ✓ |
| `agent` | Safe request intake and catalog staging | ✓ | ✓ |

The sidebar, mobile navigation, dashboard metric cards, and primary action buttons all navigate through the same view state. Browser history is supported, and a refreshed URL restores the active view.

## Global interaction contract

- The top-bar search searches invoice number/customer, customer contact/GSTIN, and product name/SKU/HSN code.
- Selecting a result navigates to the owning view and clears the global query. View-specific search fields reuse the same state, so search remains consistent while moving between records.
- Appearance themes (`dark`, `slate`, `corporate`) are persisted through `PUT /api/profile` and cached locally for resilient startup. Invoice document themes are separate and selected in tenant settings.
- Loading, failed requests, permission failures, and validation failures are surfaced as typed API errors and user-visible status toasts; no destructive action is silent.

## Print and billing templates

`InvoicePreview` is the document template boundary. It renders seller snapshot data, customer data, tax splits, payment history, UPI QR, and invoice totals. `window.print()` activates the print stylesheet, which removes application chrome and produces a paper-safe layout. XLSX export is a separate server endpoint and is not coupled to DOM rendering.

## API and safety rules

- Route handlers validate request bodies with Zod and return `{ error: string }` with an appropriate 4xx/5xx status.
- `requireSession()` enforces authentication, tenant schema isolation, and role checks.
- Sensitive customer, seller, and payment fields are encrypted at rest and decrypted only at response boundaries.
- Mutations write audit records. Invoices are immutable financial records; stock changes and payment changes are transactional.
- The TypeScript compiler runs in strict mode (`npm run lint`) and tests cover GST math, ledger behavior, encryption, logos, and localization.

## Module 4–15 service contracts

The following module boundaries are implemented as tenant-scoped APIs. They are intentionally independent of the visual shell so a future mobile, customer-portal, or accounting client can reuse the same contracts.

| Module | Primary endpoints | Consistency/security rule |
| --- | --- | --- |
| Inventory & stock | `/api/inventory/batch`, `/api/inventory/variants`, `/api/inventory/movements` | Product rows are locked with `FOR UPDATE`; invoice, purchase receipt, and batch changes record stock movements. |
| Billing workflows | `/api/billing/schedules`, `/api/billing/milestones` | Schedules are versioned by status and next-run time; milestone settlement is separate from invoice issue. |
| Quotations | `/api/quotations`, `/api/quotations/:id/convert`, `/api/portal/quotations/:id/decision` | Every edit increments a version; customer decisions are linked to the authenticated customer account; conversion locks stock. |
| Tax | `/api/tax/calculate`, `/api/admin/tax-report` | GST, VAT, and sales-tax calculations share a typed engine; reports group by origin/destination jurisdiction. |
| CRM | `/api/crm/interactions` | Follow-ups have due/completed timestamps and are audit logged. |
| Vendors / purchasing | `/api/vendors`, `/api/purchase-orders`, `/api/purchase-orders/:id/receive` | Receiving locks inventory and cannot exceed ordered quantity. |
| Expenses / reporting | `/api/expenses`, `/api/reports/financial` | Receipt data is encrypted; reports expose P&L, cash flow, receivables, and inventory valuation. |
| Currency / regional | `/api/settings/regional`, `/api/currency/rates` | Currency, locale, timezone, and exchange-rate values are tenant settings, never client-selected schema values. |
| Permissions / audit | `/api/admin/permissions`, `/api/admin/audit` | Explicit user grants can override role defaults; audit records are append-only through the application API. |
| Notifications | `/api/notifications` | In-app records are user-scoped; channel values are ready for email/SMS/push workers. |
| Backup / recovery | `/api/admin/backups`, `/api/admin/backups/:id/restore` | Snapshots are SHA-256 verified and tenant-bound; recovery rehydrates catalog/customer records while preserving immutable financial documents. |
| Integrations | `/api/admin/integrations`, `/api/gateway/:provider` | Provider secrets are encrypted, outbound URLs require HTTPS, paths are relative, and calls are rate limited. |

Tenant module tables are initialized idempotently by [`platform-schema.ts`](../src/server/platform-schema.ts), which keeps existing tenant schemas and newly provisioned schemas on the same contract. The Zustand application store in [`app-store.ts`](../src/state/app-store.ts) persists active view, theme, and global search without coupling business records to browser storage.

## Module 31–40 UI and API contract

| Module | UI behavior | API boundary |
| --- | --- | --- |
| Trial / subscription | Persistent top-bar trial banner, limits, upgrade modal, and disabled invoice/template actions when expired. New tenants receive sample catalog/customer data. | `/api/onboarding`, `/api/subscription`; `requireSubscription()` enforces feature and monthly limits. |
| Profile / business switcher | Header avatar, inline display-name edit, active business list, and tenant switching without exposing another tenant's records. | `/api/profile`, `/api/businesses`; membership is verified before issuing a new session. |
| Template gallery | 100 built-in layouts (20 per document kind), cloud repository fallback, custom schemas, logo/signature placement, columns, colors, and paper sizes. | `/api/templates/gallery`, `/api/templates/render`. |
| Conversion pipeline | Source documents move to `CONVERTED`; conversion links preserve source/target IDs and carry lines, taxes, customers, and discounts. | `/api/documents/convert`, `/api/quotations/:id/convert`. |
| Navigation/action matrix | Dedicated Sales, Pricing, Notes, Ledger, Templates, and module routes; keyboard shortcuts `/`, `N`, `G`, `I`, and `Q`. | `/api/sales-documents`, `/api/pricing/*`, `/api/notes/*`, `/api/ledger/*`. |
| Pricing | Rate cards resolve by customer category and quantity slab; margin is returned only for administrators. | `/api/pricing/rate-cards`, `/api/pricing/resolve`. |
| Returns / notes | Draft credit/debit notes can be posted; sales returns restock under row locks and write negative/positive ledger and tax adjustments. | `/api/notes`, `/api/notes/:id/post`. |
| Party ledger / Khata | Customer/vendor balances include aging buckets and prepared WhatsApp/SMS/email reminder links with UPI-ready messaging. | `/api/ledger/party`, `/api/ledger/reminders`. |
| Scanner | Hardware scanner input and camera `BarcodeDetector` scanning add SKU quantities directly to the active bill with audio feedback. | `/api/barcodes/sku/:sku` returns a printable SVG barcode. |
| GST/e-invoicing | GSTR-1/2B/3B JSON exports, HSN summaries, E-invoice/E-way buttons, and provider-safe payload preview. | `/api/admin/compliance/export`, `/api/admin/compliance/einvoice`, `/api/admin/compliance/eway`. Provider submission requires configured HTTPS credentials; no fake IRN is generated offline. |

## Module 41: Predictive cash flow

The admin-only cash flow workspace (`cash-flow`) uses invoice receivables, payment transactions from the previous 365 days, and expenses from the previous 180 days. `GET /api/reports/cash-flow-forecast?days=30&openingBalance=0` returns weekly projections for a 30-, 60-, or 90-day horizon. Collection timing is estimated from the amount-weighted historical invoice-to-payment delay (capped at 365 days), falling back to 30 days when there is no payment history. Expenses are projected at the prior 180-day daily average. Opening cash is supplied by the user for that view and is not saved. The forecast does not include future sales, scheduled bills, or bank balances, so the displayed funding gap is a planning estimate rather than a bank reconciliation or guarantee.

## Module 60: Advanced document security

Expense receipt content remains AES-256-GCM encrypted at rest and is never included in expense-list responses. `documents.read` controls receipt retrieval; non-admin staff additionally require an explicit per-receipt grant managed by an administrator. Receipt access and grant changes are audit logged. The boundaries are `/api/expenses/:id/attachment` and `/api/expenses/:id/access`; user grants are stored in the tenant-scoped `DocumentAccess` table.

## Module 101: Multi-godown transfers

Warehouse balances are tracked separately in `WarehouseStock`; they are not automatically allocated from or synchronized to the legacy aggregate `Product.stock`. Admins or staff with `inventory.write` can set location balances and dispatch multi-item transfer challans. Dispatch subtracts from the source balance and records `IN_TRANSIT`; receipt atomically adds to the target balance. Both legs are recorded in `StockMovement` with a warehouse ID, and neither changes `Product.stock` nor creates sales-ledger entries. The APIs are `/api/warehouses`, `/api/warehouses/stock`, and `/api/warehouse-transfers/:id/receive`.

## Module 701: Freight-aware stock rebalancing

Module 701 extends Module 101's transfer workflow rather than creating a second transfer ledger. Dispatch accepts an optional freight amount and one allocation basis: `QUANTITY` distributes by transferred quantity; `CATALOG_VALUE` distributes by current product selling price multiplied by quantity. Integer-cent largest-remainder allocation guarantees that item shares sum exactly to the entered total. The transfer and per-item shares are stored on `WarehouseTransfer` and `WarehouseTransferItem` and shown on the challan. This is a logistics-cost record only: it does not change stock value, product price, or financial ledgers. Catalog value is a proxy, not acquisition cost; accurate landed-cost capitalization requires purchase-cost/weight data and a separate accounting workflow.

## Module 102: E-Way Bill lifecycle

`GET /api/admin/compliance/eway?invoiceId=...` reads the invoice's E-Way state. `POST` accepts `CREATE`, `UPDATE`, or `CANCEL`; creation and update require a transport mode and 1–4000 km approximate distance. Road transport additionally requires a vehicle number or transporter ID; cancellation requires a reason. Only provider-confirmed `SUBMITTED` records with an E-Way number may be updated or cancelled. A unique tenant record and locked status transition prevent duplicate submissions; retries after an ambiguous network failure are blocked as `UNKNOWN` until reconciled with the provider. A provider response without an E-Way number is `PROVIDER_ACCEPTED`, not registered.

Provider configuration uses the enabled tenant integration named `eway`, or `EWAY_PROVIDER_URL` and `EWAY_PROVIDER_TOKEN` deployment settings. The adapter receives `{ action, requestId, ewayBillNumber?, payload }` over HTTPS and must return the provider's E-Way number for the app to mark the document `SUBMITTED`. Without a provider, creation returns `READY` and stores a reviewable JSON payload only; it does not create a statutory E-Way bill. `EWAY_MIN_VALUE` configures the local value gate (default 50000 INR); this gate is not a legal eligibility determination. Applicable thresholds, exceptions, and mandatory fields must be validated against current rules and the authorized provider before production submission.

## Module 201: Pump head and discharge simulator

The inventory-read workspace solves the operating point where the entered per-stage pump head curve meets the system curve. Inputs are stage count, static/delivery head (m), pipe run (m), internal diameter (mm), Hazen–Williams C, rated voltage, measured voltage, and at least two manufacturer pump points `(flow L/min, per-stage head m)` in strictly ascending flow order. Pump head must not increase with flow. Pipe friction uses the Hazen–Williams SI equation with flow converted from L/min to m³/s and diameter from mm to m; total dynamic head is static head plus calculated pipe friction. The result reports the curve intersection, friction loss, TDH, and US GPM conversion.

Voltage correction is applied only when at least two manufacturer-provided correction points `(voltage % of rated, flow factor, head factor)` bracket the measured voltage. The factors are linearly interpolated and applied to the pump curve before solving. Without that table, the UI explicitly reports a rated-curve estimate; the system does not infer a generic motor derating from voltage alone. The solver rejects malformed or non-intersecting curves and never extrapolates beyond supplied manufacturer data. This is a planning estimate, not a guarantee of field discharge or a substitute for pump selection and installation guidance.

## Module 301: Stage-by-stage head and friction allocation

Module 301 reuses the Module 201 solver; it does not introduce a second hydraulic formula. For `N` identical stages, the per-stage manufacturer head curve is multiplied by `N` at the same flow to find the full-pump/system operating point. The output divides pump head, static head, and total pipe friction evenly by `N` for comparison. The friction split is an average allocation only: physical column friction accumulates with pipe length and is not an impeller-stage loss. Stage count must be an integer from 1 to 100. Tests verify single- and multi-stage intersections, per-stage totals, invalid stage counts, curve range handling, and friction response to length/diameter.

## Billing/POS Architecture Contract

This contract is the shared implementation target for the numbered module backlog. Module names are not separate implementations when they describe the same capability. A feature is complete only when its server-side rules, persisted state, permission checks, user workflow, audit behavior, and validation are present. A navigation entry or descriptive UI does not count as completion.

### Authority and service boundaries

- PostgreSQL in the authenticated tenant schema is the authority for customers, products, prices, tax settings, stock, invoices, payments, and audit records. Zustand may retain drafts and navigation state, but browser state is not a financial or inventory authority.
- Every API resolves the session and tenant on the server, validates input with Zod, checks role/permission and object-level access, and uses parameterized SQL or Prisma. Client-supplied totals, tax, invoice numbers, stock availability, permissions, and tenant/schema identifiers are never trusted.
- External provider calls are made through configured server-side integrations. Credentials stay encrypted and off the client. A provider timeout must not leave a half-posted invoice or stock movement; use a durable pending/outbox state and idempotent retry for provider work.
- Financial document issuance, payments, returns, and inventory mutations write an audit event in the same database transaction as their state change. Audit records are append-only through application APIs.

### Canonical records and precision

- `Product` owns SKU, description, HSN, unit, tax classification, and current price. Issued invoice lines snapshot description, HSN, quantity, unit price, discount allocation, tax rate, taxable amount, and tax split; later catalog edits never rewrite issued invoices.
- Monetary values use the currency's minor unit for calculations and persistence; quantities retain the product's declared precision. INR invoices use paise internally and round once at the documented invoice-total boundary. Tax and discount allocation must be deterministic and tested at half-cent and fractional-quantity boundaries.
- The invoice snapshot also retains seller identity, buyer identity, place of supply, currency, exchange rate (when applicable), tax result, and template identity/version needed to reproduce the issued document.
- `StockMovement` is the traceable event history. Each movement identifies product, location when known, quantity delta, before/after balance, source record, actor, and timestamp. Corrections are compensating movements, not edits to old movement history.
- **Current inventory migration boundary:** Module 101's `WarehouseStock` is separate from legacy `Product.stock`; current POS sales and purchase receipts still mutate `Product.stock`. Therefore location balances must not be presented as the POS's available quantity. Before enabling warehouse-aware checkout, migrate and reconcile opening balances, choose the fulfillment location per sale, and update that location and the compatibility aggregate in one transaction. Do not silently sum, seed, or overwrite balances during rollout.

### Invoice and payment workflow

1. The client submits customer, place of supply, product IDs, quantities, optional discount selection, and tender inputs. The server reloads current catalog, customer, tax, and pricing rules.
2. In one database transaction, lock product or location-balance rows in stable ID order; verify availability; resolve price and discount; allocate bill-level discount across lines deterministically; calculate tax from seller origin and destination; and derive totals and round-off. Reject negative quantity, invalid product, inapplicable discount, insufficient stock, and overpayment before writing.
3. Allocate the sequential invoice number under a locked sequence row. Persist the immutable invoice and lines, initial payment, stock movements, customer-ledger entries, and audit event in that transaction. Commit all effects together or none of them.
4. Return the committed server snapshot to the client. Printing/export reads that snapshot and uses a versioned template; it must not recalculate tax or totals independently.
5. Later payments append payment transactions and ledger credits. Issued invoices are not edited or deleted to correct errors; use a linked credit/debit note or reversal workflow with a reason and audit trail.
6. E-invoice, E-way bill, SMS, and payment-provider work begins only from a committed invoice state. Persist provider status and request identity; retries must be idempotent and must not allocate another invoice number or deduct stock again.

### Inventory and purchasing workflow

- Inventory mutations have a named source: sale, purchase receipt, transfer, return, or reason-coded adjustment. Every source mutation and its stock movement are atomic. Stock may not become negative, including under concurrent checkout.
- A purchase order may be received in multiple partial receipts. Each receipt locks the PO line and target stock balance, rejects cumulative received quantity above ordered quantity, posts only the received quantity, and records the receiving location and actor.
- A warehouse dispatch locks source balances, writes transfer lines, deducts source stock, and records `IN_TRANSIT` in one transaction. Destination stock changes only on receipt. Receipt locks the transfer and is permitted only from `IN_TRANSIT`; a repeated receipt returns a conflict and cannot add stock twice.
- Sales returns reference the original invoice and line, cap returned quantity at the unreturned sold quantity, and post stock, tax, customer-credit/refund, and audit effects atomically. Vendor returns are separate from customer returns and update vendor/tax balances only after an authorized posting step.
- Reorder suggestions, low-stock alerts, and dead-stock analysis are derived from persisted movements and policy settings. They create draft actions only; they do not silently place orders, change prices, or issue financial documents.

### Calculation, tax, and document invariants

- There is one server calculation path for each invoice type. POS preview may call that path, but client display math is advisory until the server returns the authoritative quote/commit result.
- For every invoice: sum of line taxable values equals invoice taxable subtotal after discount; line tax splits sum to invoice tax; taxable subtotal plus tax plus explicit round-off equals grand total; payments cannot exceed grand total; and balance due equals grand total less posted payments and credits.
- Tax rules are effective-dated and jurisdiction-aware. An issued document stores the exact rule/rate and jurisdiction inputs used, so future rule updates do not alter historical filings. Filing exports are reproducible for a closed period and identify source records and validation errors.
- Templates receive a typed immutable document snapshot. Screen, print, PDF, and export totals must match exactly. Pagination may move rows but may not omit lines, duplicate totals, or split required legal blocks. Template changes apply to new documents unless an explicit versioned reissue is performed.
- Currency conversion stores the rate, source, and as-of time used by the transaction. Payment reconciliation compares values in the transaction currency and does not infer a bank match from amount alone.

### Duplicate module normalization

The backlog contains repeated labels and overlapping numbering. Implement one capability with aliases/traceability, not duplicate tables, routes, or calculations. Examples: Modules 18 and 101 are warehouse management; 37 and 109–110 are return/adjustment workflows; 36 and 113 are pricing/rate cards; 39 and 120 are barcode workflows; 40 and 102–103 are tax compliance/provider workflows; 12, 22, 123, 124, and 164–165 overlap permissions, session security, or audit; 49, 60, 71, 82, and 93 are document security; repeated 61–100 entries should map to their unique domain capability. Keep a canonical module ID and record other numbers as aliases in the requirements matrix.

### Required validation gates

- **Calculation tests:** zero and fractional quantities, percentage and flat discounts, discount allocation remainder, inclusive/exclusive tax, intra/inter-state tax, exact rounding boundaries, multi-currency snapshots, and invalid/over-limit values. Assert the invoice invariants above for every case.
- **Database transaction tests:** successful issue posts all expected records; any failure rolls all of them back; concurrent checkouts for the last units permit at most one success; partial receipts cannot exceed ordered quantity; dispatch/receipt conserve location stock; repeated posting cannot double-apply effects.
- **Authorization and tenant tests:** exercise Admin, Sales, and Customer against every read/write boundary; verify explicit grants and revocations; verify one tenant cannot discover another tenant's customer, product, invoice, attachment, or stock by changing an identifier.
- **Workflow tests:** quotation acceptance/conversion, invoice issue/print, payment posting, sales return/refund, purchase receipt, warehouse transfer, and compliance-export flows use persisted fixtures and assert both document snapshots and ledgers.
- **UI/output tests:** validate direct-link and browser-history routing, loading/error/empty states, keyboard/scanner billing, narrow/mobile layouts, and screen/print/PDF parity. Inspect generated PDFs for page breaks, missing lines, clipped legal content, and totals that differ from the committed invoice.
- **Release gate:** run focused tests, the complete test suite, strict TypeScript check, production build, and migration/tenant-initializer idempotence test. For financial or stock migrations, rehearse on a copy, compare row counts and balances before/after, and verify a tested restore path. Do not mark a module complete when a required gate is unavailable; report it as unverified with the exact missing environment or provider dependency.

### Delivery order

1. **Transaction correctness:** auth/permissions, tax and discount calculations, invoice sequence, immutable snapshots, payments, and audit behavior.
2. **Inventory traceability:** one reconciled balance model, purchase receipts, returns, adjustments, multi-warehouse transfers, and concurrency guarantees.
3. **Documents and compliance:** versioned templates, exact print/export parity, period close, tax exports, and provider outbox/retry behavior.
4. **Automation and analytics:** reminders, reorder recommendations, pricing synchronization, forecasting, and dashboards built only from validated ledger events.
5. **External and offline capabilities:** provider integrations, queued offline operations, conflict resolution, and cross-branch consolidation, each behind explicit operational and recovery tests.

## Offline, Session, and Admin Diagnostics Contract

**Current implementation boundary:** the service worker caches the app shell and static assets only; it deliberately bypasses `/api/*`. Zustand persists view, theme, and global search. There is no IndexedDB outbox or background transaction synchronization yet, so invoice and stock writes require a live connection. The top-bar indicator reports connectivity and says writes are paused; it does not promise offline checkout.

### Existing shell controls

The app shell already provides a profile dropdown with inline display-name/avatar editing, business switching, and a persisted appearance selector including Dark Mode. The top bar now also reports browser connectivity. An offline indicator means server writes are paused; it must not imply that an invoice was saved or queued unless the durable outbox confirms that state.

### Cache and session boundaries

- The service worker may cache the app shell and versioned static assets. It must not cache authenticated `/api/*` responses, invoice/payment/customer records, access tokens, or provider credentials. A cached HTML shell is not an offline business database.
- Session credentials remain in an `HttpOnly`, `Secure`-in-production, `SameSite=Strict` cookie. Never copy JWTs into Zustand, localStorage, IndexedDB, service-worker messages, or queued payloads. Server routes must continue to revalidate session, tenant, role, and object permission on every sync request.
- TLS protects network transport; AES-GCM field encryption protects selected database values. Because server-side tax/stock/accounting logic must read invoice data, this architecture is not zero-knowledge end-to-end encryption. Never label it as such.
- Zustand persistence is limited to non-sensitive interface preferences and routing state. Draft/account data requiring offline access belongs in a dedicated IndexedDB database with explicit tenant/user/device scope, schema version, expiry, encryption policy, and deletion-on-logout behavior.
- Browser-side encryption protects stored data at rest only within its threat model. A same-origin script compromise can access decrypted data and use a non-exportable WebCrypto key; do not claim zero-knowledge or end-to-end encryption while the server must read invoice fields to calculate tax, reserve stock, or issue legal documents.

### Offline write and synchronization protocol

1. Offline UI creates a local draft, not an issued invoice. It receives a cryptographically random idempotency key and stores only the minimum required fields in an encrypted, tenant/user-bound outbox entry.
2. The UI clearly labels queued work as `PENDING_SYNC`; it does not display a legal invoice number, confirmed payment, stock deduction, or successful settlement before server commit.
3. On reconnect, Background Sync may wake the worker where supported; an online-event/foreground retry is mandatory as a fallback. Requests use bounded exponential backoff with jitter and stop on authentication, schema, or permission errors.
4. The server binds each idempotency key to the authenticated tenant and operation hash. Replays return the original result. It reloads current catalog, tax, pricing, and stock, then applies the existing transaction/row-lock rules; client totals, time, tenant IDs, or stock are never authoritative.
5. If price/tax/catalog or stock has changed, return `CONFLICT` with a safe summary and require staff review. Do not silently overwrite an issued invoice, merge money fields, or retry a conflict as a new operation.
6. Outbox states are `PENDING_SYNC`, `SYNCING`, `COMMITTED`, `CONFLICT`, `NEEDS_AUTH`, and `FAILED`. State transitions are durable and auditable; queued data is retained until commit or an explicit, confirmed discard.
7. Logout clears decrypted in-memory data and revokes the server session. Encrypted queued records remain bound to the same tenant/user and require a fresh authorized session before retry; account switching never replays another user's queue.

### Admin diagnostics and recovery

- Runtime reports are tenant-scoped and bounded. The client and server redact common credential patterns, email addresses, phone numbers, and long numeric identifiers before storage/display; this pattern-based sanitizer is not a guarantee against arbitrary PII, so callers must not put secrets or customer data in error messages. Only Admin can view reports or record a resolution; resolution changes are audited.
- The current health route checks database connectivity only. The diagnostics screen exposes that check and runtime error reports; it is not a general server CPU, disk, queue, or code-repair console.
- Admin recovery UI may run only predefined operations such as health check, reload instructions, static-cache refresh, or retry of a known outbox item. It must not execute arbitrary JavaScript, SQL, shell commands, or client-provided repair scripts.
- A resolution note closes an incident record; it does not claim that deployed code was patched. Code fixes still require a reviewed release and rollout. Any automated self-healing action must be allowlisted, idempotent, reversible where possible, and audited.

### Required offline/security validation

- Unit-test idempotency-key replay, tenant binding, operation-hash mismatch, retry-state transitions, backoff caps, and conflict detection.
- Integration-test offline draft persistence, browser restart, logout/account switching, expired-cookie reauthentication, reconnect synchronization, duplicate delivery, and concurrent stock depletion. Assert exactly one committed invoice/stock mutation.
- Inspect service-worker caches to prove no private API response or session secret is stored. Test cache version upgrades and logout cleanup on desktop and mobile browsers.
- Test Admin/Sales/Customer access to diagnostics and sync endpoints; confirm unauthorized resolution and cross-tenant outbox replay fail with no data leakage.
- Simulate server timeout after commit and before response; a retry must return the original committed invoice rather than create a second invoice or decrement stock twice.
