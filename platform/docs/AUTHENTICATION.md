# Authentication and Security Guide — darkworld.website

## 1. Current approach

The platform uses tenant-slug + username + password sign-in. Passwords are hashed with bcrypt. Successful authentication issues a signed HS256 JWT in an HTTP-only, SameSite=Strict cookie; the cookie is Secure in production and expires after eight hours. There is no browser localStorage token.

`src/server/auth.ts` is authoritative for server-side identity and role verification. `src/middleware.ts` provides coarse API path/role gating. Every handler still must call the appropriate auth/permission helper and scope data to its tenant and resource.

## 2. Roles and permissions

- **ADMIN:** business settings, catalog/team administration, reports, audit, and explicitly protected integrations/backups.
- **SALES:** core checkout, product/customer lookup, and permitted customer/payment workflows.
- **CUSTOMER:** own portal resources only.
- **Operator:** separate out-of-band `PROVISIONING_SECRET` for provisioning/fleet operations, not a tenant login role.

Legacy `STAFF` is normalized to `SALES`. `defaultPermissions` and tenant `UserPermission` grants define effective permissions. Deny by default when the role or permission is unknown. A route path role rule does not replace operation-level permission and resource checks.

## 3. Login/logout flow

### Login request

```http
POST /api/auth/login
Content-Type: application/json

{"tenant":"business-slug","username":"owner","password":"<password>"}
```

Server validates bounded input, finds enabled/non-maintenance tenant, resolves the tenant schema from the platform directory, checks active user and bcrypt hash, loads current permissions, then sets the cookie. Invalid credentials should remain generic. Login attempts are limited in-process and at Nginx; this is not a shared limiter across replicas.

### Logout

```http
POST /api/auth/logout
```

Server clears the cookie. The client must clear cached user/workflow UI state.

## 4. Session validation and protected APIs

For each sensitive request:

1. Verify JWT signature and expiry using the server-only `JWT_SECRET`.
2. Validate tenant ID, generated schema identifier, and session role.
3. Re-read tenant status/schema mapping from public DB.
4. Resolve tenant DB only from that validated mapping.
5. Re-read user disabled state and current role.
6. Enforce action permission and object ownership in handler.

Do not trust role, tenant, customer ID, or schema values supplied in the request body. Customer portal access must verify linked `customerId` for every object.

## 5. Password reset and registration

Public registration, email verification, password reset, social login, and self-service password change are not established as current flows/API endpoints. Do not invent endpoints or claim support.

Before adding password reset: approve email delivery, token expiry, single-use storage/hash, account enumeration behavior, rate limits, audit behavior, and support recovery. Require an authenticated recent re-authentication for password changes. Provision tenant users via protected operator/admin workflows.

## 6. Cookie, CSRF, and browser protections

- Keep session cookie HTTP-only, Secure in production, SameSite=Strict, scoped to `/`.
- Do not expose JWT in JSON, logs, localStorage, URLs, or telemetry.
- Keep state-changing APIs same-origin; do not broaden CORS without a threat-model review.
- For any future cross-site workflow, implement explicit CSRF protection and origin checks.
- Do not permit untrusted reverse-proxy forwarding headers to influence security decisions.

## 7. Secrets and environment

| Variable | Purpose | Handling |
|---|---|---|
| `JWT_SECRET` | Sign/verify app session | Unique random value, >=32 bytes, not shared with other secrets |
| `PROVISIONING_SECRET` | Operator provisioning/fleet access | Separate unique random value, >=32 bytes |
| `DATA_ENCRYPTION_KEY` | Application field encryption | Unique key in required encoding/length per `field-encryption.ts`; securely backed up |
| `DATABASE_URL` | Restricted app DB connection | Server-only; never client-visible |

Rotate with an explicit compatibility plan. Rotating field encryption key without re-encryption can make protected data unreadable. Keep keys out of Git and logs; restrict `.env` permissions.

## 8. Authorization test checklist

- No cookie → 401 on protected API.
- Invalid/expired JWT → 401.
- Unknown role → denied.
- Sales/customer role on admin API → 403.
- Role disabled/changed after login → previous session is rejected or reflects newly computed permissions as designed.
- Disabled tenant/maintenance tenant → existing authenticated requests blocked.
- Tenant A cannot use tenant B's IDs/slugs or manipulate a schema parameter to access B.
- Customer cannot access another customer's invoices, statements, or quotations.
- Direct API requests are denied even when UI controls are hidden.
- Operator secret never authorizes tenant business endpoints.
- Every high-impact mutation is audited without logging secrets or PII.

## 9. Authentication error and logging strategy

Return generic invalid-login messages; use 401/403/429 consistently. Do not return password hash, token claims that reveal sensitive state, SQL errors, exception stack, or tenant existence to unauthorized callers. Record sanitized event category and correlation ID only. Protect audit logs and do not log request bodies/auth headers.

## 10. Security review findings to keep visible

- Login throttle and some integration counters are in-memory; use a shared store before multiple app replicas.
- Middleware is coarse path-role protection; handlers must remain the source of authorization truth.
- No payment webhook or online settlement behavior is implemented.
- Deployment health and in-memory session signing configuration must be consistent across replicas before scaling.
- Cookie/CSRF/origin handling and account lifecycle should be verified in staging and supported browser matrix.

## 11. Troubleshooting

| Symptom | Likely cause | Safe check |
|---|---|---|
| Login always rejected | Wrong tenant slug, disabled tenant/user, invalid credentials | Confirm slug and operator-controlled tenant status without revealing credentials |
| 401 after deployment | Secret changed, cookie expired, clock/config issue | Check server configuration consistency and cookie flags; reauthenticate |
| 403 after role update | Effective permission or role mapping | Inspect current role/permission through admin workflow and audit trail |
| User still sees old access | Stale client UI state or permission cache | Verify every API handler rechecks authorization; refresh and test direct API |
| Provisioning returns 401/503 | Secret mismatch or missing configuration | Check protected secret source without echoing its value |

Do not disable auth or weaken role checks as a production troubleshooting shortcut.
