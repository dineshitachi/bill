# Testing and QA — darkworld.website

## 1. Strategy

Prioritize data correctness and tenant isolation before visual polish. Test pure domain logic, API authorization/validation, database transactions/migrations, and end-to-end user journeys. Tests use synthetic data in isolated local/staging environments. Never use production as a test database.

## 2. Current tools

- Node.js built-in test runner via `tsx --test tests/*.test.ts`.
- TypeScript check via `npm run lint` (`tsc --noEmit`).
- Next production build via `npm run build`.
- PostgreSQL and Prisma for integration/database checks.
- Browser automation (Playwright recommended) is a future addition unless already configured separately; do not claim it exists in the package manifest.
- k6 is the recommended load-test tool, not currently wired as an npm script.

## 3. Local test setup

From `platform/`:

```powershell
npm ci
npx prisma generate
npm test
npm run lint
npm run build
```

Database-backed tests require a dedicated disposable Postgres database with test-only credentials and migrations applied. Ensure test cleanup targets only generated synthetic tenants.

## 4. Test levels

### Unit

Cover GST jurisdiction/rounding, discount allocation, ledger serialization, encryption/decryption, logo validation, locale formatting, and other pure functions. Fixtures should be deterministic and synthetic.

### API/integration

Use an isolated test tenant and real PostgreSQL transactions to verify:

- Login/session behavior and role permissions.
- Tenant/customer scoping for every ID-based endpoint.
- Zod validation, content-length/body caps, and status codes.
- Invoice + inventory + ledger + initial payment atomicity.
- Concurrent stock contention and payment overage rejection.
- Tenant provisioning rollback and migration paths.
- Provider timeout/invalid response behavior using mocked outbound HTTP.

### End-to-end

Automate the following in a fresh test tenant:

1. Admin signs in and updates business settings.
2. Admin creates product/customer and staff account.
3. Staff searches and issues invoice; stock decrements exactly once.
4. Staff records partial payment; balance and history update.
5. User prints/exports invoice and sees the immutable snapshot.
6. Unauthorized user is denied and customer portal sees only own records.
7. Logout clears session; expired/disabled session is denied.

## 5. Test matrix

| Area | Positive case | Negative/edge cases |
|---|---|---|
| Auth | Admin/staff/customer login | Wrong slug/password, disabled user, expired token, brute force limit |
| Tenant isolation | Query own records | Swap tenant IDs/schema, cross-tenant resource ID |
| Invoice | Valid taxed sale | Missing product, bad quantity, discount over subtotal, invalid state code |
| Inventory | Stock receipt and checkout | Concurrent oversell, negative quantity, repeated submission |
| Payment | Partial then full receipt | Zero/negative, overpayment, duplicate request, concurrent receipt |
| Upload | Valid resized logo/screenshot | Oversize, malformed base64, spoofed MIME, unsupported image, missing body |
| Integrations | Valid configured provider | Timeout, bad credentials, private URL/redirect, invalid response |
| Error states | Retry safe read | Uncertain financial write, network loss, DB unavailable |
| Responsive/accessibility | Mobile and keyboard flows | 320px overflow, no focus, unlabeled control, dialog focus loss |
| Recovery | Restore synthetic backup | Missing key, checksum mismatch, wrong tenant/backup |

## 6. Responsive, accessibility, and network QA

- Check checkout, search, product form, invoice preview, settings, and dialogs at 320/375/768/1280px widths.
- Test keyboard-only use, focus visibility, labels, contrast, announcements, screen-reader tables, and reduced motion.
- Use browser network throttling for high latency, packet loss/offline, slow provider response, and reconnect.
- Confirm mutations are not silently duplicated; uncertain invoice/payment results require lookup/reconciliation before retry.
- Offline invoice creation is not supported in this shared platform and should be communicated clearly.

## 7. Performance and load testing

Use k6 in staging with production-like synthetic tenant counts and record a baseline before changing thresholds. Cover login, search, dashboard, invoice list, concurrent checkout/stock contention, payment updates, and exports. Run ramp, steady, spike, and soak phases while monitoring app CPU/memory, DB connections/locks/slow queries, and response latency.

Product/operations must approve measurable p95 latency, error-rate, concurrency, and resource thresholds. Do not perform high-volume tests against production.

## 8. Security and database testing

- Review OWASP authorization, IDOR, input handling, CSRF/origin, SSRF, upload, sensitive-data exposure, and rate-limit risks.
- Test every route directly, not just UI actions.
- Verify public/tenant migrations from empty and prior supported states.
- Test unique constraints, row-lock behavior, foreign-key cleanup, and audit records.
- Restore an encrypted backup into an isolated environment and verify invoice/login workflows and encryption-key availability.
- No security review or penetration test is implied by passing the standard test suite.

## 9. Test data

- Use generated businesses, users, customers, and products with obvious synthetic labels.
- Keep deterministic fixtures and passwords out of production.
- Provisioning currently adds demo items/customer; tests must identify these explicitly and clean only the isolated test tenant.
- Do not run broad deletes in a shared database.
- Never attach production dumps or customer screenshots to CI artifacts.

## 10. CI/CD

Recommended pipeline:

1. Install locked dependencies with `npm ci`.
2. Generate Prisma client.
3. Run focused and full unit tests.
4. Run `npm run lint`.
5. Build production app.
6. In a separate integration job, start disposable PostgreSQL, apply migrations, run API/tenant tests, and destroy only that service.
7. Stage deploy, run smoke and authorization checks, then require human production approval.

Do not store provider production credentials in pull-request workflows. Pin actions/images and review dependency updates.

## 11. Coverage and release criteria

Do not set a fabricated line-coverage target. Require coverage for every P0 business invariant, permission boundary, and failure mode; publish reports once coverage tooling is approved. Release blockers: cross-tenant access, unauthorized mutation, incorrect tax/payment/stock, unverified restore, secret exposure, or unresolved critical/high security issue.

## 12. Bug report template

```text
Title:
Environment/build:
Role and synthetic tenant:
Preconditions:
Steps to reproduce:
Expected:
Actual:
Frequency:
Request/correlation ID (if safe):
Impact and data-integrity risk:
Screenshots/logs (redacted):
Severity: Critical / High / Medium / Low
```

Never include passwords, tokens, customer PII, payment credentials, or raw production records.

## 13. Troubleshooting

- Tests cannot connect: verify dedicated test `DATABASE_URL`, Postgres readiness, and no production target.
- Prisma client mismatch: run `npx prisma generate` after dependency/schema change.
- Flaky concurrency tests: use transaction barriers/controlled test setup rather than arbitrary sleeps.
- Build fails after migration change: inspect schema/migration history and test fresh plus upgrade paths.
- Browser test fails due to provider: mock network calls; do not require a live paid service for core CI.
