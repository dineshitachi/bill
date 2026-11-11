# Implementation Plan — darkworld.website

This plan brings the existing platform to an explicit, testable launch baseline. It is not a commitment to a specific calendar date: dependencies, approvals, and complexity determine elapsed time. The existing codebase already contains many modules; validate them rather than rebuilding.

## Milestones

| Phase | Deliverable | Exit condition |
|---|---|---|
| 0. Scope and risk | Approved product scope, roles, payment position, SLO/RPO/RTO | Open decisions in PRD resolved or deferred explicitly |
| 1. Baseline verification | Environment inventory, build/test baseline, dependency and data review | Reproducible checks and no ambiguous production/demo data |
| 2. Security and tenant boundaries | Auth/permission matrix and cross-tenant tests | No unauthorized access in automated role/object tests |
| 3. Core workflows | Validated invoice, inventory, payment and customer journeys | Transaction and concurrency tests pass |
| 4. UX and resilience | Mobile, network/error states, accessibility and performance baseline | Critical journeys meet approved acceptance targets |
| 5. Operations | Backup/restore, monitoring, TLS and runbooks | Isolated restore succeeds and owner signs off |
| 6. Release and follow-up | Staged release, rollback, incident handoff | Release gate checklist complete |

## Phase 0 — Product decisions (Medium)

**Dependencies:** none.

**Tasks:**

- Confirm target segment, geography, languages, and GST/compliance claims.
- Freeze MVP modules and role permissions.
- Decide subscription/trial expiry behavior, records retention, and support owner.
- Confirm no online gateway settlement until provider/webhook design is approved.
- Define launch SLO, RPO/RTO, browser support, and data retention.

**Deliverable:** approved [PRD](./PRD.md) decisions and acceptance criteria.

## Phase 1 — Baseline and data hygiene (Medium)

**Dependencies:** Phase 0 for production scope.

- Inventory production/staging/development hosts, domains, tenants, user accounts, secret locations, and backups.
- Determine whether starter/demo records exist in each tenant; do not delete without owner approval and verified backup.
- Confirm exact Node/Next/React/Prisma/PostgreSQL versions from manifests and lockfiles.
- Run `npm ci`, `npm test`, `npm run lint`, `npm run build`; record existing failures before changes.
- Review `.gitignore`, generated artifacts, production logs, and secret exposure history; rotate exposed secrets.
- Record API endpoints and role coverage.

**Deliverable:** environment inventory, known-issues baseline, data cleanup approval.

## Phase 2 — Security and authorization (High)

**Dependencies:** Phase 1.

- Build endpoint-by-role matrix for ADMIN, SALES, CUSTOMER, and operator credentials.
- Add/verify handler-level permission checks and customer-resource scoping.
- Test session expiry, disablement, role change, tenant disable/maintenance, and cross-tenant object IDs.
- Review API-key rotation, provisioning, integration secrets, data encryption keys, and access controls.
- Audit Zod validation/body bounds, upload handling, provider URLs, output errors, and logs.
- Replace process-local security rate limits with shared storage only if multiple replicas are in scope; otherwise keep single process and test edge controls.

**Deliverable:** authorization tests, security findings and remediation record.

## Phase 3 — Core business workflows (High)

**Dependencies:** Phase 2.

- Validate fresh tenant provisioning and upgrade migration paths.
- Verify product/customer search and checkout data contracts.
- Exercise price/tax/discount calculations against approved fixtures.
- Test atomic invoice + line + initial payment + ledger + stock update.
- Add concurrent oversell and overpayment tests.
- Verify invoice snapshots, payment history, print/export, and accounting totals.
- Add bounded pagination to high-growth lists where current fixed or unbounded reads are inadequate.

**Deliverable:** accepted core workflow suite with rollback/reconciliation notes.

## Phase 4 — UX, accessibility, and resilience (Medium/High)

**Dependencies:** stable core flows.

- Test pages at phone/tablet/desktop sizes and supported browser matrix.
- Run keyboard/screen-reader smoke checks, visible focus, contrast, dialog focus, and validation announcement tests.
- Simulate slow network, timeout, provider outage, reconnect, and uncertain write outcomes.
- Verify loading/empty/error states and safe retry semantics.
- Run k6 staging load test after approving thresholds; monitor app and DB pool/connection metrics.
- Fix only measured UI/query bottlenecks; do not add cache infrastructure speculatively.

**Deliverable:** usability and performance acceptance evidence.

## Phase 5 — Operations and data recovery (High)

**Dependencies:** production-like staging environment.

- Configure secure secrets, trusted TLS, firewall, private DB/app network, and least-privilege app role.
- Automate encrypted off-host backup according to approved RPO/retention.
- Restore to isolated infrastructure and verify application encryption keys, tenant schemas, billing, and login.
- Add health/readiness/container checks and centralized operational alerts appropriate to the host.
- Document rollback, migration, certificate renewal, incident escalation, and restore steps.

**Deliverable:** operations owner signs backup/restore and deployment runbook.

## Phase 6 — Release (Medium)

**Dependencies:** all P0 gates complete.

- Deploy a release candidate to staging; run smoke suite and role/tenant isolation tests.
- Confirm no test data, credentials, debug endpoints, or sample account shortcuts remain.
- Confirm product marketing claims match actual payment, tax, and availability capability.
- Approve release/rollback window and notify support/operations owner.
- Deploy single app instance per current process-local state assumptions.
- Monitor errors, database load, TLS, backups, and support feedback after release.

**Deliverable:** signed release checklist and post-release review.

## Conditional future work

| Workstream | Dependency | Complexity |
|---|---|---|
| Payment provider + signed webhook + reconciliation | Provider approval, legal/finance requirements, idempotency model | High |
| Email/SMS delivery | Provider, consent/template/retention policy, durable retries | Medium |
| Background queue/workers | Async work requirement, idempotent job contracts | Medium |
| Multiple app replicas/autoscaling | Shared sessions/limits, externalized file state, connection budget, migration job | High |
| CDN | Explicit cache policy for static-only assets and origin rules | Low/Medium |
| DB read replicas/HA | Defined RPO/RTO and observed primary bottleneck | High |
| Sharding | Evidence simpler measures cannot meet SLO | Very high |
| MCP or autonomous agents | Approved use case, threat model, tool boundaries, data review | High |

## Dependencies and decision gates

```text
Product approval
  -> environment/data baseline
  -> auth + tenant-isolation verification
  -> financial workflow verification
  -> responsive/network/performance acceptance
  -> recovery/operations evidence
  -> release approval
```

No phase authorizes deleting production data, changing payment semantics, or deploying without a designated human owner.
