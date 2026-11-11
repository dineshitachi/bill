# Debugging and Troubleshooting — darkworld.website

## 1. Safe debugging workflow

1. **Identify:** collect environment, build/version, affected role/workspace, timestamp, and safe request ID.
2. **Scope:** determine whether issue is UI, API/auth, tenant DB, provider, proxy, or host.
3. **Reproduce:** use synthetic data in local/staging; capture only redacted evidence.
4. **Inspect:** compare expected API status/schema, app logs, DB health, and recent deployment/migration.
5. **Fix:** make the smallest root-cause change; preserve tenant and financial invariants.
6. **Verify:** run focused tests, `npm test`, `npm run lint`, and relevant build/smoke tests.
7. **Recover:** if production data may be affected, stop repeated mutations and follow reconciliation/restore runbook with an owner.

Never disable authorization, delete a database volume, replay financial writes blindly, or run destructive test commands against production.

## 2. Logs and diagnostics

From `platform/`:

```powershell
docker compose ps
docker compose logs --tail 100 app nginx db
docker compose logs --since 15m app
```

Use app logs for sanitized route/service failures, Nginx logs for proxy/TLS/upstream status, and PostgreSQL logs for connection/query/constraint failures. Do not enable request-body logging for auth, provisioning, invoices, or customer data. Redact tokens, email, phone, and numeric identifiers before sharing logs.

`/api/health` checks a database query; it does not prove that login, every tenant schema, billing, provider integrations, or backup restore is healthy.

## 3. Common symptoms

| Symptom | Likely area/cause | Steps |
|---|---|---|
| Site unavailable | DNS/TLS/Nginx/container/host | Check DNS, certificate paths/expiry, `docker compose ps`, Nginx logs, host 80/443 reachability |
| 502 from proxy | App not ready, wrong upstream/network, migration/startup failure | Inspect app logs and DB health; verify Compose private network and startup migration |
| `/api/health` 503 | Public DB connection/query failure | Check DB container health, `DATABASE_URL`, Postgres logs and storage; do not expose DB port publicly |
| Login returns generic 401 | Wrong tenant slug/credentials, disabled user/tenant | Verify slug and tenant status through controlled operator flow; do not enumerate users |
| Login returns 429 | In-process or Nginx limit reached | Wait for window, check trusted proxy IP and staging policy; don't remove rate limiting |
| 403 on API | Role/permission or route policy | Check current role/effective grant and handler guard; test direct request |
| Invoice rejected for stock | Product unavailable or concurrent checkout | Refresh stock and invoice draft; do not override the stock guard |
| Invoice/payment outcome uncertain | Browser/network interrupted after commit | Query invoice/payment history before retrying; add idempotency/reconciliation if absent |
| Provider unavailable | URL/token/quota/network/timeout | Verify secret presence without printing value; check provider status and safe timeout logs |
| Export fails | Dataset size, memory, permission, or workbook error | Check bounded query and sanitized server log; test smaller synthetic date range |
| Upload rejected | Format/size/body limit or malformed payload | Verify actual encoded bytes and supported image; do not bypass limits |
| Cross-tenant record missing | Wrong workspace/session or correctly scoped denial | Confirm current tenant; never switch schema using a request parameter |

## 4. Authentication and authorization debugging

- Inspect cookie presence/flags in browser developer tools without copying token contents into tickets.
- Confirm `JWT_SECRET` has not changed unexpectedly across instances/restarts.
- Confirm app clock is correct and cookie is unexpired.
- Verify tenant is enabled, not in maintenance, schema name matches directory, user is active, and role is current.
- Reproduce with explicit admin/staff/customer test accounts and direct API calls.
- Never print JWT, password, provisioning secret, API key, or decrypted database record during debugging.

## 5. Database and migration debugging

- Check DB health, connection count, free disk, and migration process before restarting repeatedly.
- Compare `prisma/schema.prisma`, migration history, and actual schema; do not hand-edit production schema as a shortcut.
- Tenant changes must exist in fresh provisioning and tenant upgrade paths, not only public Prisma migration.
- For deadlock/slow query issues, identify request/query shape and inspect query plan on staging data.
- For migration failure, preserve data, capture migration name/status, take a backup, and ask the DB owner before any repair.
- Never remove `postgres_data` to "reset" production.

## 6. Provider, AI, and integration debugging

- Separate configuration failure, DNS/TLS/connectivity, timeout, provider 4xx/5xx, and invalid response.
- Test with mocked responses first, then provider sandbox.
- Verify outbound endpoint is HTTPS and approved; do not use arbitrary URLs to probe networks.
- Confirm response validation and timeout; don't return raw provider body to user.
- For AI, verify provider is configured, request context is bounded, and returned content is treated as untrusted text. Do not send customer/invoice/payment records.
- There is no MCP runtime integration to debug. See [MCP.md](./MCP.md) before proposing one.
- There is no inbound payment webhook; manual payment status must not be interpreted as provider settlement.

## 7. Performance debugging

1. Measure request latency and status at Nginx/app.
2. Check app CPU/memory/restarts and database connection/pool waits.
3. Identify slow endpoint/query with tenant-safe request metadata.
4. Reproduce in staging with representative data and query plan.
5. Add pagination/index only when the query plan supports it; measure write/storage impact.
6. Run k6 staging profile and compare against approved thresholds.

Do not add Redis, replicas, or autoscaling before locating the bottleneck and establishing connection limits.

## 8. Frontend and network debugging

- Use browser devtools Network to inspect status and response shape; redact cookies/headers before sharing.
- Check console for client error name/route, not raw state or PII.
- Simulate mobile dimensions, slow network, offline, and reconnect.
- A failed GET can usually be retried; a timed-out invoice/payment POST may have committed. Verify server state first.
- Service worker must not cache `/api/` or private business data; unregister/update only as a controlled browser test if stale generic shell is suspected.

## 9. Recovery, monitoring, and escalation

For suspected data loss, unauthorized access, secret disclosure, or incorrect financial records:

1. Stop further affected writes if safe and notify the designated owner.
2. Preserve sanitized logs and database state; do not modify evidence.
3. Revoke/rotate exposed credentials using approved runbook.
4. Reconcile invoices/payments with authoritative transaction records.
5. Restore only from a verified encrypted backup under owner approval.
6. Record scope, timeline, customer impact, and corrective action.

No Sentry/LogRocket or centralized tracing service is configured by this documentation set. Select one only after privacy/retention review. Never add PII-heavy replay or payload capture by default.

## 10. Feature debugging checklist

- **Login:** tenant slug, tenant state, user state/role, cookie flags, signing secret consistency.
- **Checkout:** product IDs/stock, tax inputs, discount, transaction/lock result, duplicate request.
- **Payment:** invoice balance, row-lock conflict, amount/method, existing transaction before retry.
- **Upload:** request byte count, supported format, encoded/decoded size, proxy body cap.
- **Export:** authorized role, query range/row count, memory, response headers, cache policy.
- **Portal:** linked customer identity, object ownership, tenant/customer scope.
- **Provider:** configured endpoint, credentials present, timeout, response schema, no raw secret/body logging.

## 11. Example sanitized report

```text
Environment: staging / build <version>
Role: SALES / synthetic tenant
Route: POST /api/invoices
Request ID: <non-sensitive correlation ID>
Status: 409
Observed: stock conflict on concurrent checkout
Expected: no oversell; draft remains editable
Data integrity: verified one committed invoice and matching stock decrement
Secrets/customer data: excluded
```
