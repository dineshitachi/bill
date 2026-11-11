# Architecture — darkworld.website

## 1. Architecture decisions

### MVP architecture

Use the existing modular monolith:

- Next.js App Router with TypeScript for UI and server route handlers.
- PostgreSQL 16 for platform and tenant data.
- Prisma 5.22 for typed database access and public-schema migrations.
- One PostgreSQL schema per tenant, selected only from a verified session.
- Nginx for TLS termination and coarse edge request limits.
- Docker Compose for a single-host deployment.

This is the simplest reliable architecture already present. Do not introduce microservices, Kubernetes, Redis, or a queue until a measured requirement justifies them.

**Version note:** documentation previously described Next.js 14; the package manifest currently declares Next.js 16.4.5 and React 19.2. Source docs must follow the lockfile/package manifest and supported framework docs when implementation changes are made.

## 2. System context and data flow

```text
Browser
  -> HTTPS / Nginx
  -> Next.js UI and /api route handlers
      -> session verification + current tenant/user checks
      -> tenant Prisma client (tenant schema from DB-verified session)
      -> platform Prisma client (public schema)
      -> optional server-side provider calls
  -> PostgreSQL (public platform schema + isolated tenant schemas)
```

1. Browser sends a same-site session cookie to the app through Nginx.
2. Middleware performs coarse path/role gating; each route handler performs authoritative session, permission, and tenant-scoped resource checks.
3. Server resolves the tenant from the signed session and verifies the tenant directory's schema mapping and status.
4. Tenant database operations use the generated tenant Prisma client; platform operations use the public client.
5. Mutations validate input and use database transactions/locks for financial and inventory invariants.
6. Responses are shaped intentionally, decrypting only fields authorized for the current response.
7. External providers are called server-side with timeouts; credentials never go to the browser.

## 3. Frontend and backend boundaries

- Server components/layout provide app shell and static structure.
- Client components manage ephemeral UI state and call same-origin APIs.
- Zustand stores client workflow state; local persistence is limited to safe preferences/drafts, never the canonical invoice/payment source of truth.
- Route handlers are the backend application boundary. They authenticate, validate, authorize, call domain helpers, and serialize results.
- Domain helpers own tax, ledger, encryption, subscription, provisioning, and document rules; UI components must not reimplement financial calculations as authoritative.

## 4. Folder structure

```text
platform/
  src/
    app/                 App Router pages, layouts, and API route handlers
      api/               Same-origin REST-like endpoints
    components/          Reusable UI and feature components
    server/              Auth, Prisma clients, encryption, domain services
    state/               Client-side UI/workflow state
    diagnostics.ts       Telemetry scrubbing helpers
    gst.ts, ledger.ts... Pure/shared domain logic
  prisma/
    schema.prisma        Public platform schema and canonical models
    migrations/          Versioned public-schema migrations
  scripts/               Deployment, tenant migration, provisioning helpers
  db/init/               Least-privilege database role setup
  nginx/                 Reverse-proxy/TLS config template
  docs/                  Product, design, API, database, and operations docs
  tests/                 Node test-runner unit/integration tests
```

## 5. Database interaction

- `src/server/db.ts` exports a process-level public `PrismaClient` and lazily caches clients for validated generated tenant schema identifiers.
- Tenant schema names must match the generated identifier format and must never be accepted from request parameters.
- Public tenant directory maps tenant UUID and slug to a schema; authenticated session validation checks that mapping.
- Public migrations use Prisma Migrate. Tenant schemas use provisioning DDL plus versioned tenant migration scripts and the idempotent platform-table initializer.
- Financial mutations use one database transaction. Lock affected inventory/payment rows and use database constraints/guarded updates for invariants.
- Use decimal database types for money/quantity; convert to display formatting only at response/UI edges.
- Add indexes from query plans and access patterns; list APIs need bounded pagination before datasets grow.
- The per-tenant Prisma client cache implies connection growth with active tenant schemas; keep a single app process until connection budgeting and shared coordination are verified.

## 6. Authentication and authorization

- Login verifies bcrypt password hash and tenant status.
- Session is a signed HS256 JWT in an HTTP-only, SameSite=Strict cookie, eight-hour maximum lifetime; Secure in production.
- Server auth rechecks tenant enabled/maintenance, schema mapping, user disabled state, and current role.
- Middleware provides coarse API role gates; route handlers must call `requireSession`/`requirePermission` and enforce object ownership.
- Tenant admin, sales, and customer roles are supported. Customer portal operations must scope rows to the authenticated customer ID.
- Operator provisioning/fleet access uses a separate high-entropy secret header, not a tenant session.
- CSRF posture relies on same-site cookie policy and same-origin application APIs; review origin checks and allowed methods before broadening cross-origin access.

## 7. API architecture

- APIs are same-origin JSON endpoints under `/api/`; provisioning/fleet endpoints are grouped under `/api/v1/`.
- Route handlers use Zod schemas, bounded body parsing where needed, standard status codes, and `{ error: string }` client errors.
- Keep success response shapes stable and avoid serializing Prisma models directly.
- Use 401 unauthenticated, 403 forbidden, 404 non-disclosing resource absence, 409 conflict, 422 only if established consistently, 429 limited, and generic 5xx.
- Long-running exports should be bounded in MVP; future background jobs must be idempotent and status-addressable.
- No inbound payment webhook contract is implemented; do not document one as live.

## 8. External services and AI

- PostgreSQL is the only required application data service.
- Optional provider calls (AI, GST verification, exchange rates, document integrations) occur from server routes and require configured URLs/tokens.
- Apply explicit timeouts, validate provider responses, avoid forwarding PII, and return a clear unavailable/degraded state.
- The assistant receives only bounded catalog/business context according to current product documentation. It stages local drafts; checkout/payment remains user-confirmed.
- Agent request records are human-reviewed task intake, not autonomous coding agents.
- No MCP server is connected by the product runtime. Developer MCP tooling is external to this deployed app.

## 9. Environment configuration

Required deployment values include `DATABASE_URL`, `JWT_SECRET`, `PROVISIONING_SECRET`, and `DATA_ENCRYPTION_KEY`, plus PostgreSQL bootstrap credentials and `DOMAIN` for Compose. Optional values include GST, AI, exchange, template, e-invoice, and e-way provider URL/token/model settings.

Maintain separate secret values per purpose/environment; never prefix secrets with `NEXT_PUBLIC_`. See [SETUP.md](./SETUP.md) and [INTEGRATIONS.md](./INTEGRATIONS.md) for variable names and safe configuration.

## 10. Errors and observability

- Return user-safe error messages and correct status codes; log server-side diagnostic context without secrets, request bodies, or PII.
- Include correlation/request identifiers in future centralized logging.
- Client error telemetry is sanitized and best effort; it is not operational monitoring or uptime assurance.
- `/api/health` currently checks database connectivity. Add separate liveness/readiness checks before orchestrated replicas.
- Do not retry non-idempotent billing/payment writes blindly.

## 11. Security boundaries

1. Public internet terminates at TLS proxy; app and database are not host-published.
2. Nginx applies API request/connection controls; application authorization remains required.
3. Public schema contains tenant directory and operator metadata; tenant schemas hold business records.
4. Database role is restricted; schema identifiers are server-generated and validated.
5. Application encryption protects selected PII; DB volumes/backups still require infrastructure encryption.
6. Service worker bypasses API and business data. CDN, if later added, must never shared-cache private/authenticated responses.
7. Integration secret and AI credentials are server-only. Logs, errors, analytics, agent prompts, and uploaded files must not become secret exfiltration paths.

## 12. Testing and deployment

- Unit tests cover deterministic domain logic (tax, ledger, encryption, localization).
- API/integration tests use a test database and synthetic tenant data to cover sessions, authorization, tenant isolation, transaction invariants, validation, and migrations.
- E2E tests cover login, checkout, payment, print/export, and admin tasks across desktop/mobile.
- Run `npm test`, `npm run lint`, and production build before deployment.
- Compose deployment builds a standalone image, applies public migrations, runs tenant migration script, then starts the app. For future replicas, move migrations to a one-time release job.
- Backups must be encrypted, off-host, retained, and restored in an isolated drill.

## 13. MVP vs. future scale

**MVP:** single app process, one PostgreSQL cluster, tenant schemas, Nginx, manual verified backup/restore, bounded API lists, optional provider integrations.

**Future after measured need:** shared rate-limit storage, PgBouncer/managed pooler validated with tenant schema routing, durable queue/workers, CDN for immutable public assets, multiple app replicas, DB read replicas/HA, then tenant-to-cluster sharding only as a last resort.

## 14. Architecture decisions requiring approval

- Managed vs. on-prem host and the desired availability model.
- Whether/when online payment, message delivery, durable async jobs, and external object storage become launch requirements.
- SLO, RPO/RTO, log retention, data residency, and secrets management provider.
- Whether user role/permission semantics are frozen before third-party client/API access.
