# Setup and Initialization — darkworld.website

This guide covers local development and the existing Docker Compose deployment. Use isolated synthetic data locally. Never place production secrets or database exports in a development workspace.

## 1. Prerequisites

- Windows, macOS, or Linux development machine.
- Node.js 22 and npm (match the Docker runtime).
- Git and VS Code (recommended).
- PostgreSQL 16, either installed locally or provided by Docker Compose.
- Docker Engine/Desktop with Compose v2 for container deployment.
- For public deployment: Linux host recommended, DNS record, trusted TLS certificate, firewall access to TCP 80/443, and protected secret storage.

## 2. Clone and install

```powershell
git clone <repository-url>
Set-Location <repository-folder>\platform
npm ci
npx prisma generate
```

Use the repository's approved URL; do not embed credentials in it. The application is located in `platform/`; the root Windows app is separate.

## 3. Configure local environment

Create `platform/.env.local` and keep it ignored by Git. Required values:

```dotenv
DATABASE_URL=postgresql://app:local-only-password@localhost:5432/namma_bill?schema=public
JWT_SECRET=<unique-random-secret-at-least-32-bytes>
PROVISIONING_SECRET=<different-unique-random-secret-at-least-32-bytes>
DATA_ENCRYPTION_KEY=<valid-32-byte-key-encoding-for-field-encryption>
NODE_ENV=development
```

Check `src/server/field-encryption.ts` for accepted key encoding before generating `DATA_ENCRYPTION_KEY`. Use three distinct random values. Do not use the literal placeholders above.

Optional integrations:

```dotenv
GSTIN_PROVIDER_URL=
GSTIN_PROVIDER_TOKEN=
AI_BASE_URL=
AI_MODEL=
AI_API_KEY=
EXCHANGE_RATE_URL=
EXCHANGE_RATE_TOKEN=
TEMPLATE_REPOSITORY_URL=
EINVOICE_PROVIDER_URL=
EINVOICE_PROVIDER_TOKEN=
EWAY_PROVIDER_URL=
EWAY_PROVIDER_TOKEN=
```

Leave unset unless the authorized provider contract is configured. Secrets must be server-only; never use `NEXT_PUBLIC_` prefixes.

## 4. Start PostgreSQL and migrate

Use an isolated local database and the restricted app role when possible. For the public schema:

```powershell
npm run db:deploy
npx prisma generate
```

Tenant schemas are created by the protected provisioning flow. Do not create a tenant by hand in a production database.

## 5. Run locally

```powershell
npm run dev
```

Open `http://localhost:3000`. To provision a test tenant, use the project's provision helper configured against the local DB and local-only `PROVISIONING_SECRET`; see `scripts/Provision-Tenant.ps1` and `scripts/provision-tenant.ts`. Keep the returned API key private even in development. Provisioning currently adds demo catalog/customer records.

## 6. Verify setup

In another terminal:

```powershell
Invoke-WebRequest http://localhost:3000/api/health
npm test
npm run lint
npm run build
```

Health returns a successful status only when the public database query works. Sign-in requires a provisioned tenant and user. Verify login, product listing, a test invoice, and logout using synthetic records. Do not interpret health as full end-to-end readiness.

## 7. Deploy with Docker Compose

Before deploying:

1. Point `darkworld.website` DNS to the server.
2. Obtain a trusted certificate for the exact domain and install `platform/certs/fullchain.pem` and `platform/certs/privkey.pem`.
3. Restrict host/firewall ingress to required ports and keep PostgreSQL/app unexposed.
4. From `platform/`, run:

```powershell
.\scripts\Deploy-OnPrem.ps1 -Domain darkworld.website
docker compose ps
docker compose logs --tail 100 app nginx db
```

The script creates a protected `.env` if one does not exist and validates secret strength/distinctness. It does not overwrite an existing `.env`. Review [platform README](../README.md) for certificate renewal, tenant provisioning, backup, and firewall details.

Provision a business from an administrator workstation with `scripts/Provision-Tenant.ps1`; provide the provisioning secret securely, not through shell history or chat. Save the one-time returned tenant API key in an approved secrets store.

## 8. Database and test data safety

- Use separate local/staging/production databases.
- Never point local `.env.local` at production.
- Do not seed or delete production data based on a filename or "demo" label without tenant-owner approval and verified backup.
- Use a dedicated test database for destructive integration tests.
- Verify encryption key backup before restoring encrypted data.

## 9. MCP and external services

No MCP server is required or configured for the current app. The optional AI assistant, GST, exchange, e-invoice, and e-way integrations require provider credentials and an approved endpoint. Configure only in server environment; see [INTEGRATIONS.md](./INTEGRATIONS.md).

## 10. Common setup issues

| Symptom | Likely cause | Resolution |
|---|---|---|
| Prisma cannot connect | DB stopped, wrong URL/schema, port unavailable | Check DB process and `DATABASE_URL`; verify from local machine |
| `JWT_SECRET` configuration error | Empty, placeholder, too short, or invalid value | Generate a distinct random secret of at least 32 bytes |
| Encryption key error | Unsupported encoding or not exactly 32 decoded bytes | Follow `field-encryption.ts` key parsing rules |
| Login fails after provisioning | Wrong tenant slug, disabled tenant/user, or stale data | Use exact provisioning slug; check tenant status in local DB |
| TLS proxy does not start | Certificate missing, wrong domain, or unreadable key | Install trusted matching certificate and check file permissions |
| Container cannot reach DB | Compose env/config/network mismatch | Review `.env`, `docker compose ps`, and restricted internal network |
| Migration fails | Schema drift or previous migration partially applied | Stop deployment, preserve DB, inspect logs and migration state; do not delete volume |
| Provider is unavailable | Optional endpoint/token missing or provider contract mismatch | Keep feature disabled; verify HTTPS endpoint and provider response |

## 11. Useful commands

```powershell
npm test
npm run lint
npm run build
docker compose ps
docker compose logs --tail 100 app nginx db
docker compose restart app
```

For recovery, follow the backup/restore procedure in the existing deployment README and the operational checklist. Never remove the PostgreSQL data volume as a troubleshooting shortcut.
