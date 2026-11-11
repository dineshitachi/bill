# Product Requirements Document — darkworld.website

**Status:** Working specification; approvals listed at the end  
**Product:** Namma Bill POS multi-tenant web platform  
**Audience:** Product, design, engineering, QA, and operations

## 1. Product summary

darkworld.website is the public deployment domain for a secure, browser-based billing and business-management product. Each business gets an isolated workspace for inventory, customers, GST-aware invoicing, payment recording, quotations, and reporting. Operators provision workspaces; businesses do not create an unbounded public signup account.

The web platform is designed for online, shared use across a business team. It is not the offline-first Windows application in the repository root.

## 2. Problem and value proposition

Small and mid-sized businesses need a dependable way to maintain stock, create accurate invoices, track partial payments, and share current business records among staff. Spreadsheet and paper workflows make stock errors, tax arithmetic mistakes, lost payment history, and delayed reconciliation more likely.

**Value proposition:** one tenant-scoped workspace that brings billing, catalog, customer, payment, and operational reporting together, with server-calculated tax and a printable invoice trail.

## 3. Target users

| User | Needs | Product access |
|---|---|---|
| Business owner / tenant administrator | Configure business identity, staff, catalog, tax settings, review financials, and manage integrations | Admin workspace |
| Sales / billing staff | Find products/customers, issue invoices, record received payments, and prepare quotations | Staff workspace |
| Customer account user | Review their own invoices/statements and respond to shared quotations where enabled | Customer portal |
| Platform operator | Provision and disable tenants, rotate platform keys, and monitor operational metadata | Protected operator workflows |

Assumption: the initial market is Indian businesses that need GST-style billing and INR defaults. Multi-currency and broader tax-rule features exist, but statutory compliance remains the operator/business's responsibility.

## 4. Goals and success measures

### Product goals

- Let an authorized user issue an accurate invoice and update stock in one safe workflow.
- Make partial payments traceable without changing the historical invoice snapshot.
- Keep tenant data isolated and staff access limited by role and permission.
- Support practical daily work on desktop and mobile browsers with clear failure recovery.
- Give operators a controlled provisioning and recovery path.

### Measures to establish before launch

- Invoice completion success rate and median time to create an invoice.
- Invoice, payment, stock-adjustment, and export error rates.
- p95 API and page-load latency under an agreed representative load.
- Successful backup restore and tenant-isolation test results.
- Support incidents caused by billing, permissions, or data loss.

Targets are deliberately not invented here. Product and operations must approve measurable thresholds and SLOs.

## 5. Scope

### Core launch scope

1. Operator-provisioned tenant and initial administrator.
2. Secure sign-in, session lifecycle, tenant isolation, and admin/staff permissions.
3. Product catalog, customer records, inventory viewing, and stock-aware checkout.
4. GST-aware invoice calculation, issue, print/export, and immutable history.
5. Cash/manual payment recording, partial balances, and payment history.
6. Dashboard and essential invoice/inventory/customer/accounting views.
7. Business settings, team management, audit trail, and protected operational controls.
8. Database backup, restore documentation, health checks, and safe user-visible errors.

### Current product capabilities beyond the core

Quotations, customer portal, recurring billing schedules and milestones, multiple warehouses, purchase orders, expense tracking, CRM interactions, tax rules/reports, document templates/conversion, regional settings, notification preferences, agent request intake, AI-assisted catalog drafting, and additional exports are present in parts of the current application. They should be maintained where already shipped, but launch acceptance for each requires explicit product prioritization.

### Out of scope for the initial launch unless approved

- Public self-service signup, SaaS billing collection, and automated subscription payment.
- Online payment processing, settlement reconciliation, and inbound payment webhooks.
- Government GST filing, e-invoice/IRN issuance, e-way bill issuance, or guaranteed live GSTIN verification.
- Offline invoice creation/synchronization in the shared multi-tenant web app.
- Autonomous AI actions, AI approval of financial operations, or AI access to customer/payment data.
- Per-tenant infrastructure, database sharding, or multi-region active-active deployment.

### Future scope

Authorized payment-provider integration and signed webhooks; email/SMS delivery; managed object storage for uploads; background workers for large exports and notifications; shared rate-limit storage; multi-replica deployment; advanced reconciliation; and database HA based on measured needs.

## 6. Core user journeys and user stories

### Provision and first sign-in

1. Operator supplies a business slug and initial administrator details using the protected provisioning flow.
2. System creates a tenant schema, administrator account, membership, and starter catalog examples.
3. Operator securely transfers the one-time tenant API key and sign-in URL.
4. Administrator signs in, verifies business settings, replaces starter/demo items, and creates staff accounts.

**Stories**
- As an operator, I can provision or disable a tenant without exposing tenant records to other tenants.
- As a tenant administrator, I can sign in and complete business setup without editing environment secrets.

### Create and issue an invoice

1. Staff selects or creates a customer, searches inventory, and enters quantities.
2. System calculates discounts/tax on the server and checks current stock.
3. Staff reviews totals and records an optional initial payment.
4. On confirmation, the system atomically creates the invoice/ledger/payment records and decrements stock.
5. Staff prints/downloads the invoice and can later view payment balance/history.

**Stories**
- As staff, I can create an invoice from current product prices and available stock.
- As an owner, I can rely on totals and stock changes being committed together or not at all.
- As a customer, I can receive a clear invoice with tax and payment information.

### Record a later payment

1. Authorized staff/admin opens the invoice and reviews remaining balance.
2. User enters amount and payment method.
3. Server locks/updates the invoice and records a payment transaction atomically.
4. Invoice status and history reflect the committed payment.

### Maintain inventory and customers

Administrators create/update products and manage catalog settings. Staff can look up products and add customers when permitted. Stock adjustments and receipts are auditable; users see validation and conflict feedback rather than silent overwrites.

### Review business operations

Owner opens dashboard, invoice history, low-stock view, and accounting summaries; filters/searches; exports records; and follows links to the source records.

### Customer portal

An eligible customer account sees only its associated invoices/statements and can accept or decline a shared quotation where configured. It cannot access the tenant's general catalog, other customers, or admin APIs.

## 7. Functional requirements

Priority: **P0** launch-critical, **P1** valuable follow-up, **P2** future/conditional.

| ID | Priority | Requirement |
|---|---|---|
| FR-01 | P0 | Operator-only tenant provisioning creates an isolated schema and an initial administrator. |
| FR-02 | P0 | Login validates tenant slug, username, password, tenant state, and user state; failures do not disclose which credential was wrong. |
| FR-03 | P0 | Authenticated operations derive tenant/schema from a verified server session, never from a browser-selected schema. |
| FR-04 | P0 | Admin and sales permissions are enforced server-side for every protected API and object. |
| FR-05 | P0 | Admin can create, edit, and disable team accounts and manage tenant business settings. |
| FR-06 | P0 | Authorized users can list/search products/customers and view inventory. |
| FR-07 | P0 | Admin can create/update catalog records; stock cannot be oversold through concurrent checkout. |
| FR-08 | P0 | Invoice creation validates lines, prices from the database, quantities, discount, tax jurisdiction, and available stock server-side. |
| FR-09 | P0 | Invoice, items, ledger snapshot, initial payment, and stock decrement are transactionally consistent. |
| FR-10 | P0 | Invoice history is immutable for financial facts; corrections use approved adjustment/return workflows, not silent edits. |
| FR-11 | P0 | Payments support partial receipts, method, actor, timestamp, and remaining-balance calculation. |
| FR-12 | P0 | Invoice preview/print and permitted exports preserve the stored invoice snapshot. |
| FR-13 | P0 | User-facing loading, empty, validation, authorization, network, and server-error states are understandable and recoverable. |
| FR-14 | P0 | Sensitive API responses and business data are excluded from shared service-worker/CDN caching. |
| FR-15 | P0 | Health endpoint, deployment guidance, backup procedure, and isolated restore process are documented and testable. |
| FR-16 | P1 | Admin can review audit events and financial/stock reports with bounded data retrieval. |
| FR-17 | P1 | Customer portal limits every resource to the authenticated customer account. |
| FR-18 | P1 | Quotations can be prepared, shared, accepted/declined by an eligible customer, and converted safely. |
| FR-19 | P1 | Admin may configure approved external integrations; secrets remain server-side and outbound requests are bounded. |
| FR-20 | P2 | Large exports, scheduled communications, and other non-interactive work can use a durable background queue. |
| FR-21 | P2 | Online payment provider callbacks are authenticated, idempotent, replay-safe, and reconciled before enabling settlement claims. |
| FR-22 | P2 | Shared rate limiting and replicated app deployment are validated before adding app replicas. |

## 8. Roles and permissions

| Capability | Platform operator | Tenant admin | Sales/staff | Customer |
|---|---:|---:|---:|---:|
| Provision/disable tenant, fleet metadata | Yes, protected secret | No | No | No |
| Dashboard, inventory/product lookup | Operational only | Yes | Yes | No |
| Create invoices and record payments | No | Yes | Yes | No |
| Catalog CRUD, settings, team, integrations | No | Yes | No | No |
| Customer create/update and customer lookup | No | Yes | Limited by permission | Own portal identity only |
| Financial reports, audit, backup controls | No | Yes (as explicitly authorized) | No | No |
| Own invoices/statements/quotation decision | No | No by default | No | Yes, customer-scoped |

The implemented role set is ADMIN, SALES (legacy STAFF normalizes to SALES), and CUSTOMER. Explicit permission grants can override defaults. Exact module-by-module grants and sales-user access to payment/customer mutations require approval; never rely on UI hiding alone.

## 9. Pages and screens

- Sign-in and session-expired state.
- Main dashboard with business metrics and actionable links.
- Billing/checkout with customer, product search, line items, tax, discount, and confirmation.
- Invoice list/search, invoice detail/preview, print, spreadsheet export, and payment history.
- Inventory, low-stock, product create/edit, stock movement and warehouse screens as enabled.
- Customer list/detail and customer balances.
- Accounting/payment reporting and financial summary.
- Quotations and price list; customer portal invoice/statement/quotation decision screens.
- Admin team, permissions, business settings, audit, integrations, tax/compliance, backups, and subscription screens.
- Agent request inbox and optional assistant workflow.
- Loading, no-results, permission-denied, offline/network failure, and service-unavailable views.

## 10. Data requirements

- Tenant directory contains tenant UUID, slug, generated schema name, hashed tenant key, enable/maintenance/subscription flags, locale, and settings.
- Tenant business records live in a per-tenant PostgreSQL schema.
- Core records: users, products, customers, invoices, invoice items, payment transactions, ledger entries, audit logs, and tenant operational data.
- Financial values use fixed-precision decimals, not floating-point storage.
- Invoices retain seller/customer/tax snapshots so reprints remain historically accurate.
- Selected PII and configuration fields use application-level authenticated encryption; passwords use bcrypt hashes.
- Tenant API keys are stored as hashes; integration credentials are encrypted at rest.
- Retention, deletion, legal hold, export, and customer-data deletion policy require business/legal approval.
- Starter/demo records are clearly identified and must be confirmed/removed per tenant before production billing.

## 11. Integrations

| Integration | Current status | Product behavior |
|---|---|---|
| PostgreSQL / Prisma | Required, implemented | Authoritative tenant and business data store |
| Nginx / TLS | Deployment component | HTTPS termination, proxying, and coarse request limits |
| OpenAI-compatible chat-completions provider | Optional, implemented | Server-side assistant; bounded business/catalog context only |
| Authorized GST verification provider | Optional, implemented adapter | Live verification only when configured; never equate format validation with government verification |
| E-invoice/e-way providers | Optional adapter/configuration | Provider response is distinct from official status until the authorized integration contract is verified |
| Exchange-rate provider/template repository | Optional configuration | Bounded external data lookup |
| Payment gateway/webhooks | Not implemented | Manual payment recording only; no automatic settlement claim |
| Email/SMS/push provider | Not established | Browser notifications and user-prepared sharing links are not delivery guarantees |
| MCP servers | Not configured in product runtime | No MCP dependency for core workflows |

## 12. Non-functional requirements

- **Security:** HTTPS in production; strong separate secrets; least-privilege DB role; signed HTTP-only SameSite session; server-side role/tenant checks; validation; bounded uploads; safe error responses; secrets and PII excluded from logs.
- **Tenant isolation:** all business reads/writes execute through the session-selected tenant schema; test cross-tenant access explicitly.
- **Correctness:** invoice/tax/payment/stock changes use decimal arithmetic, database transactions, and appropriate row locks.
- **Availability:** initial deployment is a single app and database stack and is not HA. State measurable availability objectives before making an SLA.
- **Performance:** use bounded queries, indexes informed by query plans, and realistic load tests. Define latency thresholds before release.
- **Compatibility:** current source uses Next.js 16.4.5, React 19.2, TypeScript, Node 22 in Docker, PostgreSQL 16, and Prisma 5.22; confirm supported exact versions before upgrades.
- **Accessibility:** keyboard-operable controls, semantic labels, visible focus, sufficient contrast, and understandable validation/error announcements.
- **Responsive behavior:** primary flows work at phone, tablet, and desktop breakpoints; validate with browser testing.
- **Recoverability:** backups are encrypted and off-host; restore drills are required. Manual `pg_dump` alone is not automated PITR or failover.
- **Privacy:** customer/payment data is not sent to the assistant provider; telemetry is minimized and redacted.

## 13. Loading, empty, and error states

- Loading: show local progress for the active operation; disable duplicate submission while mutation is in flight.
- Empty: explain what is empty and provide an authorized next action (for example, add product); do not imply a failed fetch returned no records.
- Validation: associate field-level messages with fields and preserve safe user input.
- Authentication/permission: show sign-in or explain missing permission; do not reveal protected resource existence.
- Network/server failure: show a retry action where safe and communicate when outcome is uncertain; never retry a financial mutation blindly.
- Conflict/stock unavailable: return to editable checkout with current stock and preserve the draft.
- Optional-provider failure: mark that feature unavailable; core billing continues where safe.
- Offline: state that shared-platform writes are unavailable; do not queue invoices locally.

## 14. Assumptions and decisions requiring approval

### Assumptions

- darkworld.website refers to the current `platform/` deployment, not the root Windows-only application.
- Initial market is Indian businesses; INR and GST are defaults.
- Tenant onboarding remains operator-controlled.
- Core billing can launch without payment gateway settlement, statutory filing, or outbound message delivery.
- Existing broad modules are documented but may be phased independently from core billing acceptance.

### Product/owner approval required

1. Confirm business segment, geography, languages, and statutory/compliance claims.
2. Choose the exact launch feature set and whether existing advanced modules are supported at launch.
3. Approve pricing/subscription lifecycle and what happens to existing data after trial/expiry.
4. Approve staff permissions for customer edits, payment recording, returns, exports, and stock changes.
5. Define invoice numbering, cancellation/credit-note, retention, privacy, and accounting correction policy.
6. Decide payment provider and webhook scope before advertising online payments.
7. Set SLO, RPO, RTO, data retention, and support/incident ownership.
8. Approve mobile/browser support matrix and localization coverage.

Until approved, treat these as open decisions; do not infer them in implementation.
