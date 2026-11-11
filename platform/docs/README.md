# darkworld.website Platform

Multi-tenant billing and business-management web application for operator-provisioned businesses. This repository folder is the online Next.js/PostgreSQL platform; the separate Windows/offline application lives at the repository root.

## Features

- Tenant-schema isolation with operator-controlled provisioning.
- Admin, sales, and customer roles with server-side authorization.
- GST-aware invoicing, inventory, customer records, partial payment tracking, and ledger snapshots.
- Printable invoices, spreadsheets, quotations, reporting, and additional business modules.
- Optional server-side AI assistant for bounded catalog Q&A and editable drafts.
- Docker Compose deployment with PostgreSQL and Nginx TLS proxy.

Payment gateway settlement, inbound payment webhooks, statutory filing, and offline checkout are not enabled in the current platform.

## Technology

Node.js 22, Next.js 16.4.5, React 19.2, TypeScript, PostgreSQL 16, Prisma 5.22, Zod, and Docker Compose. Confirm versions against `package.json`, lockfile, and deployment image before upgrades.

## Structure

```text
src/app/          Pages and API route handlers
src/components/   UI components
src/server/       Authentication, database, encryption, domain services
src/state/        Client workflow state
prisma/           Public schema and migrations
scripts/          Provisioning, tenant migration, deployment utilities
db/init/          PostgreSQL role bootstrap
nginx/            HTTPS reverse-proxy template
tests/            Automated tests
docs/             Product and engineering source-of-truth documents
```

## Local development

Prerequisites: Node.js 22, npm, and PostgreSQL 16 (or Docker Compose for a local database).

From `platform/`:

```powershell
npm ci
# Configure a local-only .env.local using the names in SETUP.md.
npx prisma generate
npm run db:deploy
npm run dev
```

In another terminal:

```powershell
npm test
npm run lint
npm run build
```

Do not use production credentials or real customer data in development.

## Deployment

For the documented on-prem deployment, configure DNS and trusted TLS, then run from `platform/`:

```powershell
.\scripts\Deploy-OnPrem.ps1 -Domain darkworld.website
```

The script generates protected secrets in `platform/.env` if absent, validates required secrets, and starts the Docker Compose deployment when certificates exist. Keep PostgreSQL and app ports private. See the existing [`platform README`](../README.md) for provisioning, operations, backup, and TLS renewal steps.

## Documentation map

| Document | Purpose |
|---|---|
| [PRD](./PRD.md) | Scope, requirements, user journeys, open decisions |
| [DESIGN](./DESIGN.md) | UI and interaction source of truth |
| [ARCHITECTURE](./ARCHITECTURE.md) | Runtime boundaries and deployment architecture |
| [DATABASE](./DATABASE.md) | Schema, migrations, backend data flows |
| [API](./API.md) | Current endpoint inventory and conventions |
| [AGENTS](./AGENTS.md) | Development-agent policy and product assistant guardrails |
| [PLAN](./PLAN.md) | Phased implementation and release plan |
| [SETUP](./SETUP.md) | Local/deployment setup |
| [FEATURES](./FEATURES.md) | Feature-by-feature implementation guide |
| [AUTHENTICATION](./AUTHENTICATION.md) | Sessions, role checks, security review |
| [MCP](./MCP.md) | MCP is not currently configured; future decision guide |
| [INTEGRATIONS](./INTEGRATIONS.md) | Optional providers and external service status |
| [TESTING](./TESTING.md) | QA strategy and acceptance checklist |
| [DEBUGGING](./DEBUGGING.md) | Troubleshooting procedures |
| [UI specification](./UI-SPEC.md) | Existing UI and module contracts |
| [Production readiness](./DARKWORLD-PRODUCTION-READINESS.md) | Go-live checklist |
| [Scalability roadmap](./DARKWORLD-SCALABILITY-ROADMAP.md) | Measured scaling sequence |

## API summary

The same-origin `/api/` surface includes authentication/profile, dashboard/search, products/customers/invoices, inventory, accounting/reports, admin/team/settings, portal, and optional integration modules. Operator provisioning/fleet APIs are under `/api/v1/`. See [API.md](./API.md) for the route inventory. There is no payment webhook route.

## AI and MCP

The optional assistant requires provider configuration and remains advisory: users review and submit all billing actions. It receives bounded catalog/business context, not invoice/payment/customer records. There are no production MCP servers or autonomous coding agents.

## Contributing

1. Read the relevant docs and source code before changing behavior.
2. Keep tenant isolation and handler-level authorization intact.
3. Update public Prisma migrations and tenant provisioning/upgrade paths together.
4. Add focused tests and run `npm test`, `npm run lint`, and relevant build checks.
5. Do not commit credentials, customer data, backups, or generated production artifacts.
6. Have a human review financial, authorization, schema, and deployment changes.

## Roadmap

Prioritize launch acceptance and recovery, authorization/tenant isolation tests, bounded pagination, rate-limit shared state before replicas, and a verified backup restore. Payment webhooks, email/SMS delivery, durable jobs, multi-replica scaling, and database HA require explicit product/operations approval.

## License

No license grant is specified here. Confirm repository ownership and add an approved license before redistribution.
