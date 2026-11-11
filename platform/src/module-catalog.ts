export type ModuleStatus = "implemented" | "partial" | "provider" | "missing" | "needs-spec";

export type ModuleDefinition = {
  id: number;
  title: string;
  domain: string;
  summary: string;
  status: ModuleStatus;
  evidence: string;
  nextValidation: string;
};

type KnownModule = Omit<ModuleDefinition, "id" | "domain">;

const knownModules: Record<number, KnownModule> = {
  1: { title: "Authentication & role-based access", summary: "JWT sessions, Admin/Sales/Customer roles, tenant validation, permission grants, and sliding refresh.", status: "partial", evidence: "Auth routes, middleware, and tenant permission checks exist.", nextValidation: "Test role matrix, expiry/refresh, revocation, and cross-tenant ID access." },
  2: { title: "Dashboard & dynamic routing", summary: "Persistent Zustand view/theme/search state, URL-backed views, global search, and dynamically loaded workspaces.", status: "partial", evidence: "App shell and persisted client state exist.", nextValidation: "Test route history, state recovery, and search coverage across entities." },
  3: { title: "Document templates & printing", summary: "Invoice, quotation, and receipt rendering from business records with browser print and a template gallery.", status: "partial", evidence: "Invoice preview, template catalog, and render APIs exist.", nextValidation: "Verify screen/print/PDF parity, pagination, and all required template variants." },
  4: { title: "Inventory & stock", summary: "Product catalog, variants, stock adjustments, movement history, low-stock display, and locked invoice deductions.", status: "partial", evidence: "Inventory APIs and transaction-level stock checks exist.", nextValidation: "Run concurrent oversell, adjustment rollback, and channel-sync tests." },
  5: { title: "Billing & invoice generation", summary: "Sequential invoice numbers, line tax/discount calculation, initial payments, ledger entries, and recurring/milestone endpoints.", status: "partial", evidence: "Invoice and billing workflow routes exist.", nextValidation: "Run rounding, idempotency, rollback, proration, and partial-tender cases." },
  6: { title: "Quotation workflow", summary: "Versioned quotations, customer portal decisions, and conversion into invoice workflows.", status: "partial", evidence: "Quotation, conversion, and portal decision routes exist.", nextValidation: "Test every source-to-target conversion and immutable source status." },
  7: { title: "Tax calculation & reporting", summary: "GST calculation by seller/destination state, configurable tax rules, and compliance exports.", status: "partial", evidence: "Shared GST engine and tax APIs exist.", nextValidation: "Test effective dates, jurisdiction boundaries, and filing reconciliation." },
  8: { title: "Customer relationship management", summary: "Customer records, interaction history, follow-up records, balances, and customer portal surfaces.", status: "partial", evidence: "Customer, CRM interaction, and portal routes exist.", nextValidation: "Test reminders, object-level privacy, and complete client workflow coverage." },
  9: { title: "Vendor & purchasing", summary: "Vendor directory, purchase orders, partial goods receipts, and receiving stock movements.", status: "partial", evidence: "Vendor, PO, and receipt routes exist.", nextValidation: "Test vendor invoice matching, returns, payable posting, and partial receipt concurrency." },
  10: { title: "Expenses & financial reports", summary: "Expense ledger with encrypted receipt data and financial summary endpoints.", status: "partial", evidence: "Expense APIs and financial report route exist.", nextValidation: "Reconcile reports against a complete double-entry ledger and tested fixtures." },
  11: { title: "Currency & regional settings", summary: "Tenant locale, timezone, base currency, and exchange-rate endpoints.", status: "partial", evidence: "Regional settings and currency-rate routes exist.", nextValidation: "Test transaction-rate snapshots and realized/unrealized FX accounting." },
  12: { title: "User permissions & security audit", summary: "Role defaults, explicit per-user permission overrides, and application audit records.", status: "partial", evidence: "Permission and audit APIs exist.", nextValidation: "Test revocation, all write paths, and append-only/tamper guarantees." },
  13: { title: "Notifications", summary: "Tenant-scoped in-app notification records and read state.", status: "partial", evidence: "Notification endpoints and table exist.", nextValidation: "Implement and test channel workers, retries, and user preferences." },
  14: { title: "Backup & recovery", summary: "Tenant snapshot creation, checksum storage, and guarded restore workflow.", status: "partial", evidence: "Backup and restore routes exist.", nextValidation: "Rehearse scheduled encrypted backups and full restore verification." },
  15: { title: "API integration framework", summary: "Encrypted provider connections and HTTPS outbound gateway with request throttling.", status: "partial", evidence: "Integration configuration and gateway routes exist.", nextValidation: "Test provider contracts, retries, inbound events, and secret rotation." },
  16: { title: "Payment gateway integration", summary: "Stripe/PayPal processing, webhook state updates, refund workflow, and tokenization.", status: "missing", evidence: "No gateway-specific transaction implementation was found.", nextValidation: "Define provider, PCI boundary, settlement model, idempotency, and sandbox tests." },
  17: { title: "Carrier shipping & tracking", summary: "Carrier quotes, labels, shipment tracking, and delivery status synchronization.", status: "missing", evidence: "No carrier workflow was found.", nextValidation: "Select supported carriers and define sandbox contract and failure handling." },
  18: { title: "Multi-location inventory", summary: "Warehouse balances and transfer operations; currently separate from legacy POS aggregate stock.", status: "partial", evidence: "Module 101 warehouse transfer subsystem exists.", nextValidation: "Reconcile balances and make POS checkout location-aware before claiming unified stock." },
  19: { title: "Reporting & analytics", summary: "Financial summaries and date-bounded report endpoints.", status: "partial", evidence: "Financial reports endpoint exists.", nextValidation: "Validate accounting statements, export formats, and analytics dimensions." },
  20: { title: "Subscription billing", summary: "Recurring billing schedules and tenant trial/plan controls.", status: "partial", evidence: "Schedule and subscription routes exist.", nextValidation: "Implement prorations, payment retries, and subscription analytics." },
  21: { title: "Data import & export", summary: "Invoice XLSX and tax/ledger export paths.", status: "partial", evidence: "Several bounded exports exist; general bulk import was not found.", nextValidation: "Test streaming imports, schema validation, rollback, and large-file limits." },
  22: { title: "Audit log & compliance", summary: "Application-level audit records for selected mutations.", status: "partial", evidence: "Audit APIs and mutation logs exist.", nextValidation: "Inventory every mutation and prove tamper resistance and retention." },
  23: { title: "Workflow automation", summary: "General trigger/action rules across business workflows.", status: "missing", evidence: "No general rule engine was found.", nextValidation: "Specify trigger semantics, retries, permissions, and loop prevention." },
  24: { title: "Document history & versioning", summary: "Versioning for quotations/templates, not a general document rollback system.", status: "partial", evidence: "Quotation version and template version fields exist.", nextValidation: "Define immutable document revisions, diff, and restore semantics." },
  25: { title: "POS compatibility", summary: "Browser POS billing, scanner input, and invoice workflows.", status: "partial", evidence: "POS billing flows exist; offline synchronization was not found.", nextValidation: "Test device behavior, network loss, and duplicate submission prevention." },
  26: { title: "Customer feedback loop", summary: "Feedback capture, triage, and resolution tracking.", status: "missing", evidence: "No customer feedback workflow was found.", nextValidation: "Define consent, storage, moderation, and resolution lifecycle." },
  27: { title: "Custom template extensibility", summary: "Custom template schema storage and rendering endpoints.", status: "partial", evidence: "DocumentTemplate model/table and gallery routes exist.", nextValidation: "Test schema validation, permissions, version compatibility, and print output." },
  28: { title: "Localization", summary: "Localized UI strings and language selection for supported languages.", status: "partial", evidence: "Localization module and tests exist.", nextValidation: "Audit all UI, templates, dates, numeric formatting, and missing translations." },
  29: { title: "System health monitoring", summary: "Health endpoint, telemetry, and client error reporting.", status: "partial", evidence: "Health and telemetry routes exist.", nextValidation: "Add operational thresholds, alert delivery, and recovery verification." },
  30: { title: "Developer SDK & webhooks", summary: "Outbound integration gateway exists; no complete public SDK/event subscription system.", status: "partial", evidence: "Generic HTTPS gateway route exists.", nextValidation: "Define versioned public API, signing, replay protection, and SDK tests." },
  31: { title: "Trial & subscription tiering", summary: "Trial status, limits, upgrade flow, and subscription enforcement.", status: "partial", evidence: "Onboarding and subscription APIs exist.", nextValidation: "Test every feature/limit enforcement boundary and lifecycle transition." },
  32: { title: "Inline profile & business switcher", summary: "Profile editing and tenant/business switching surfaces.", status: "partial", evidence: "Profile/business APIs and header UI exist.", nextValidation: "Test session rotation and data isolation after switching." },
  33: { title: "Cloud template gallery", summary: "Built-in and custom document template gallery with render support.", status: "partial", evidence: "Template gallery and render APIs exist.", nextValidation: "Verify claimed template counts and rendered output for every document type." },
  34: { title: "One-click document conversion", summary: "Document conversion records and quotation-to-invoice transitions.", status: "partial", evidence: "Conversion route and source/target links exist.", nextValidation: "Test all conversions, discounts, tax snapshots, and repeat-submit protection." },
  35: { title: "Navigation/action matrix", summary: "Hard-coded app navigation and module workspaces.", status: "partial", evidence: "Billing app defines current routes and actions.", nextValidation: "Add a canonical registry and verify action availability against permissions." },
  36: { title: "Dynamic pricing & rate cards", summary: "Rate cards, customer category, quantity slabs, and discount tiers.", status: "partial", evidence: "Pricing resolver and rate-card APIs exist.", nextValidation: "Test precedence, effective dates, margins, and channel propagation." },
  37: { title: "Credit/debit notes & sales returns", summary: "Adjustment notes with stock and ledger effects for selected flows.", status: "partial", evidence: "Notes routes and posting transaction exist.", nextValidation: "Test original-line caps, tax-period effects, refunds, and warehouse selection." },
  38: { title: "Party ledger & reminders", summary: "Party balances, aging views, and prepared reminder links.", status: "partial", evidence: "Ledger and reminder endpoints exist.", nextValidation: "Test double-entry reconciliation and automated delivery lifecycle." },
  39: { title: "Barcode & scanner", summary: "SKU barcode endpoint and hardware/camera scanner workflow.", status: "partial", evidence: "Barcode route and scanner UI exist.", nextValidation: "Test label formats, scanner throughput, and malformed/unmatched codes." },
  40: { title: "GST/e-invoice/E-Way exports", summary: "GST exports plus provider-safe E-Invoice and E-Way payload workflows.", status: "provider", evidence: "Payload APIs and provider adapters exist; live provider acceptance is unverified.", nextValidation: "Use authorized sandbox credentials and reconcile returned statutory identifiers." },
  41: { title: "Predictive cash flow", summary: "Forecasts receipts from historical payment delay and expenses from a recent run rate.", status: "implemented", evidence: "Dedicated API, UI, pure calculation, and focused tests exist; runtime tests were not run.", nextValidation: "Run tests and validate against known receivable/expense fixtures; add bank feeds and scheduled liabilities." },
  42: { title: "Advanced inventory valuation", summary: "FIFO, LIFO, and weighted-average valuation from procurement cost layers.", status: "missing", evidence: "No cost-layer valuation engine was found.", nextValidation: "Define costing policy, receipts, returns, and historical valuation tests." },
  43: { title: "Commission & royalty tracking", summary: "Configurable commission/royalty allocation and payout ledger.", status: "missing", evidence: "No commission or royalty ledger was found.", nextValidation: "Normalize incomplete source wording and define earning, reversal, and payout rules." },
  44: { title: "Supply-chain portals", summary: "Vendor/logistics collaboration, shipment updates, and document exchange.", status: "partial", evidence: "Vendor, PO, and integration primitives exist; no dedicated portal workflow.", nextValidation: "Define external identities, sharing scopes, and order/shipment state transitions." },
  47: { title: "Dynamic tax compliance", summary: "Configurable local tax rules exist; live regulatory update feed does not.", status: "partial", evidence: "TaxRule and tax reporting routes exist.", nextValidation: "Choose authoritative regulatory source and version/effective-date rules." },
  49: { title: "Document security", summary: "Encrypted expense receipts with per-document staff access and audit.", status: "partial", evidence: "Receipt attachment and access routes exist; other documents are not covered.", nextValidation: "Extend document registry, download/share controls, revocation, and access tests." },
  50: { title: "Collaborative workspace", summary: "Agent task intake exists; project/task assignment and client milestones are not complete.", status: "partial", evidence: "AgentTask model and review routes exist.", nextValidation: "Define task ownership, due dates, comments, client links, and notifications." },
  52: { title: "Automated compliance reporting", summary: "GST exports and reports exist for selected filing data.", status: "partial", evidence: "Tax export/report routes exist.", nextValidation: "Validate official schemas, reconciliation, and period-close repeatability." },
  56: { title: "Payment terms & notices", summary: "Prepared payment reminder links exist; automated terms and notice scheduling do not.", status: "partial", evidence: "Ledger reminder workflow exists.", nextValidation: "Define customer terms, due-date rules, suppression, and delivery retries." },
  57: { title: "Contract & royalty management", summary: "Contract allocation, royalty calculation, and revenue trend analysis.", status: "missing", evidence: "No contract/royalty subsystem was found.", nextValidation: "Define contract parties, clauses, rate calculation, amendments, and audit history." },
  60: { title: "Advanced document security", summary: "Encrypted expense receipts with document-level grants and audited access.", status: "partial", evidence: "Implemented for expense receipts only.", nextValidation: "Extend the same rules to invoices, contracts, exports, and shared files." },
  61: { title: "Collaborative workspace", summary: "Project/task management integrated with customer workflows.", status: "partial", evidence: "Agent task intake is narrower than a collaborative workspace.", nextValidation: "Add project membership, assignment, comments, milestones, and notifications." },
  63: { title: "Compliance reporting", summary: "Selected tax reports exist; generic regulatory report generation does not.", status: "partial", evidence: "GST reports/export routes exist.", nextValidation: "Define report schemas, authority mapping, and reconciliation tests." },
  101: { title: "Multi-godown transfers", summary: "Location stock, transfer challans, IN_TRANSIT status, and receive workflow.", status: "partial", evidence: "Warehouse tables/routes/UI exist; balances are separate from POS Product.stock.", nextValidation: "Reconcile opening stock and make checkout location-aware." },
  102: { title: "E-Way Bill lifecycle", summary: "Validated transport payloads and guarded CREATE/UPDATE/CANCEL provider lifecycle.", status: "provider", evidence: "Persisted lifecycle and adapter exist; no live NIC/GSP credentials verified.", nextValidation: "Test provider sandbox responses and reconcile ambiguous timeouts before production." },
  103: { title: "Real-time e-invoice IRN", summary: "Invoice payload and EInvoiceRecord persistence with optional provider request.", status: "provider", evidence: "Adapter exists; live IRP/GSP issuance is unverified.", nextValidation: "Use authorized sandbox, validate signed QR/IRN, and block duplicate submissions." },
  201: { title: "Pump head & discharge simulator", summary: "Solves a manufacturer pump/system-curve intersection with pipe friction and optional voltage correction.", status: "implemented", evidence: "Pure solver, UI, and focused tests exist; runtime tests were not run.", nextValidation: "Run curve fixtures against manufacturer test data and field measurements." },
  301: { title: "Stage-by-stage head allocation", summary: "Extends Module 201 by scaling per-stage head and showing average static/friction allocation.", status: "implemented", evidence: "Shared solver and stage allocation UI/tests exist; friction split is explicitly an average.", nextValidation: "Validate identical-stage assumption against manufacturer multi-stage curves." },
  701: { title: "Freight-aware stock rebalancing", summary: "Splits transfer freight by quantity or catalog value using exact-cent allocations.", status: "partial", evidence: "Freight is stored per transfer and item; it is not accounting landed cost.", nextValidation: "Add acquisition-cost basis and reconcile accounting treatment before capitalization." },
};

const domainRanges: Array<{ min: number; max: number; name: string }> = [
  { min: 1, max: 40, name: "Core Billing & Platform" },
  { min: 41, max: 100, name: "Finance & Advanced Operations" },
  { min: 101, max: 200, name: "Inventory, POS & Compliance" },
  { min: 201, max: 300, name: "Engineering & Retail Tools" },
  { min: 301, max: 400, name: "Workshop & Technical Services" },
  { min: 401, max: 500, name: "Retail Operations & Security" },
  { min: 501, max: 600, name: "Specialty Retail & Platform" },
  { min: 601, max: 700, name: "Industry-Specific POS" },
  { min: 701, max: 800, name: "Advanced Store & POS Operations" },
  { min: 801, max: 850, name: "Manufacturing & Job Work" },
  { min: 851, max: 900, name: "Civil & Project ERP" },
  { min: 901, max: 950, name: "HR, Banking & Commerce" },
  { min: 951, max: 1000, name: "Cloud, IoT & Compliance" },
  { min: 1001, max: 1034, name: "AI, Security & Platform Ops" },
  { min: 1035, max: 1400, name: "Unclassified · Needs specification" },
];

export const moduleDomains = domainRanges.map((range) => range.name);

export function getModuleDomain(id: number): string {
  return domainRanges.find((range) => id >= range.min && id <= range.max)?.name || "Unmapped";
}

export const moduleCatalog: ModuleDefinition[] = Array.from({ length: 1400 }, (_, index) => {
  const id = index + 1;
  const known = knownModules[id];
  const domain = getModuleDomain(id);
  if (known) return { id, domain, ...known };
  return {
    id,
    domain,
    title: `Module ${id} · catalog entry needed`,
    summary: "This ID is in the requested range, but its exact operational description has not been normalized into the repository catalog. No feature behavior is claimed.",
    status: "needs-spec",
    evidence: "No module-specific implementation evidence is currently linked to this ID.",
    nextValidation: "Normalize the requirement, define acceptance criteria, then implement and test the owning workflow.",
  };
});

export function resolveSelectedModule(modules: readonly ModuleDefinition[], selectedId: number): ModuleDefinition | null {
  return modules.find((module) => module.id === selectedId) || null;
}

export const moduleStatusLabels: Record<ModuleStatus, string> = {
  implemented: "Code present · unverified",
  partial: "Partial",
  provider: "Provider-dependent",
  missing: "Missing",
  "needs-spec": "Needs specification",
};