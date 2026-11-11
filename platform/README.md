# Namma Bill POS — on-premise deployment

Product and engineering source-of-truth documents are in [`docs/README.md`](./docs/README.md).

This folder is the deployable multi-tenant web platform. It runs a Next.js 16.4.5/TypeScript app, PostgreSQL, Prisma, and an Nginx HTTPS reverse proxy. The original Windows-only local app in the repository root is preserved; it uses its own SQLite database and remains the better choice for a single-computer/offline workflow.

## What this deployment provides

- Separate PostgreSQL schema per tenant, created by the protected onboarding API. Application records are queried using a tenant-specific Prisma client selected from a signed session; the browser cannot choose a schema.
- Tenant admin and staff roles enforced by server routes. Admins and staff share invoice, payment, customer, and inventory records within their tenant; staff can check out, look up inventory/customers, create customer records, and update payments on any tenant invoice. Catalog changes, deletion, business settings, team management, GST exports, and financial summaries are admin-only.
- Persistent branding, multiple invoice styles (including GST and 58/80mm thermal layouts), HSN/SAC summaries, server-calculated CGST/SGST/IGST, UPI payment QR, stock alerts, payment tracking, printable/PDF invoices, per-invoice Excel workbooks, and annual `.xlsx` summaries.
- Admins can upload a PNG, JPEG, or WebP company logo using a drag-and-drop or browse control. The browser resizes it to a fixed invoice-header canvas; encrypted company settings persist it, and each new invoice retains its own encrypted logo snapshot. Invoice lists omit the image payload and authenticated previews fetch it on demand.
- Dedicated low-stock, inventory, billing, and accounting views show available quantity, alert level, billed revenue, receipts, and balance due. Staff and admins use the same tenant database; foreground sessions refresh inventory, customers, invoices, and accounting data every five seconds and refresh on tab focus, so staff changes appear to admins without signing out. Customer invoices support partial payments by cash, UPI, bank transfer, card, hand/manual, or a custom method. Each payment is saved as a tenant-scoped transaction with its amount, method, timestamp, and staff username; payment entries update the invoice balance and status atomically and appear in invoice history, printable PDFs, and Excel exports. During upgrade, existing paid totals are preserved as clearly labeled opening-balance snapshots because the former schema did not retain individual payment events. Admins can enable low-stock and payment browser alerts in Brand settings; browser permission is needed per device. WhatsApp reminders open a prepared message for the user to review and send.
- The Quotation / Price List view lists SKU, item name, base price, and available stock for electrical products. Admins can add items; staff can create a quotation CSV from selected stock and push its quantities into checkout.
- Each confirmed sale writes an encrypted-customer, exact-decimal ledger snapshot in the same database transaction as its invoice and immediately downloads a standardized CSV row. Administrators can export the complete tenant ledger with invoice number, date, customer details, itemized breakdown, tax, and grand total. Existing invoices are backfilled during tenant migration.
- User appearance themes (Dark Mode, Slate, and Corporate) are saved to the user's profile and mirrored in local storage; these do not change the separately configured invoice print style.
- Dashboard metrics link directly to invoices, inventory, customers, and accounting. Product creation and editing use a dedicated full-page form. The accounting dashboard summarizes billed, received, and pending amounts across all invoices, lists outstanding balances, and shows the latest 200 fully paid invoices.
- The in-app language selector provides localized navigation and primary labels for the dashboard, billing, inventory, accounting, customer, and assistant-request workflows in English, Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, and Punjabi. Currency and date formatting follow the selected language. The voice assistant uses browser speech recognition and speech synthesis where supported, and the selected locale for spoken requests.
- Billing line items can be searched by product name, SKU, or HSN. Invoice previews provide a detailed print-to-PDF view, Excel export, and a WhatsApp share draft with item and payment details; the invoice PDF can be saved and attached by the sender. UPI QR codes request only the remaining balance. Online GSTIN verification uses the configured authorized provider and clearly reports when live verification is unavailable.
- A PWA install manifest and app-shell cache. API responses and billing/customer data are never cached. The multi-tenant web app does not queue or submit invoices while offline; install the existing root PWA for its local/offline workflow.
- Error-boundary recovery, stuck-action cleanup, optional explicitly registered fallback actions, and privacy-limited runtime telemetry. This is best-effort resilience, not a guarantee of uninterrupted availability or a substitute for monitoring and backups.
- A voice and business assistant for catalog questions and staged POS drafts. Its authenticated server endpoint streams to a configured OpenAI-compatible chat-completions provider; provider credentials remain server-side. The model receives only the business name and a bounded product catalog, not customer, invoice, or payment records. Exact SKU/item-name commands stage editable bill or quotation lines locally; checkout and payment actions always require the user's explicit confirmation. Browser speech recognition may use the browser's configured service. Separately, Agent requests and optional PNG/JPEG/WebP screenshots are stored in the tenant PostgreSQL schema for human review; these requests are not sent to the AI provider, and review statuses do not authorize or apply code changes. Avoid sharing secrets or customer data with either workflow.
- A fleet endpoint that exposes tenant and device health metadata only. It intentionally does not expose customer PII across tenants to a platform operator.

Each tenant has a dedicated PostgreSQL **schema**, but shares the on-premise PostgreSQL cluster and application service. Signup does not start a dedicated virtual machine or container per customer. This reduces operational overhead while keeping tenant tables isolated by schema and every application request tenant-scoped.

Platform sessions are signed, expire after eight hours, and use HTTP-only, SameSite=Strict cookies (Secure in production); user role and disabled state are rechecked against the tenant database on each request. Sensitive customer contact/location/address fields, invoice customer/issuer/payment snapshots, payment method/attribution, user display names, agent reports/screenshots, and tenant business names/GSTIN/UPI IDs are encrypted at the application layer with AES-256-GCM. Product/inventory, numeric financial fields, tenant slugs/schema identifiers, theme and notification settings, audit metadata, and other operational metadata are not field-encrypted. Serve the app only through HTTPS and encrypt PostgreSQL data volumes and backups using the host/cloud provider's managed encryption as an additional layer.

## Requirements

- Linux on-premise host recommended, Docker Engine and Docker Compose v2.
- A DNS A/AAAA record for the chosen domain pointing to the host.
- A trusted TLS certificate and private key for that exact domain.
- Inbound TCP 80/443 at the host/firewall. PostgreSQL and the Next.js app are not published to the host.

## Configure and deploy

From `platform/` in PowerShell:

```powershell
.\scripts\Deploy-OnPrem.ps1 -Domain darkworld.website
```

The script creates `platform/.env` once, with separate cryptographically random database-admin, application-database, JWT, provisioning, and data-encryption secrets. It will not overwrite an existing `.env`; before continuing, it validates that the JWT and provisioning secrets are distinct, non-placeholder, non-repetitive values encoded as hexadecimal or Base64 and contain at least 32 bytes each, and that the encryption key is distinct and exactly 32 bytes. Existing `.env` files using the published sample values or weak/duplicate secrets are rejected; replace those entries with independently generated secrets before deployment. The file is git-ignored; keep it in a protected secret store and never commit or email it. Back up `DATA_ENCRYPTION_KEY` securely and retain the same key for the lifetime of the database: losing or changing it makes encrypted fields unrecoverable.

To enable the voice assistant, set `AI_BASE_URL` to the HTTPS base URL of the OpenAI-compatible API (for example, `https://provider.example/v1`) and `AI_MODEL` to a model supported by that service. Set `AI_API_KEY` if the provider requires one, then restart the app service. Keep the key only in the protected server `.env`; it is never exposed to the browser. Without a provider URL and model, the voice Q&A endpoint reports that it is unavailable while local exact-match draft commands remain usable. Do not send sensitive customer information in assistant prompts.

Obtain a trusted certificate after DNS is live. For example, on a Linux host using Certbot standalone mode:

```sh
sudo certbot certonly --standalone -d darkworld.website
sudo install -m 0644 /etc/letsencrypt/live/darkworld.website/fullchain.pem platform/certs/fullchain.pem
sudo install -m 0640 /etc/letsencrypt/live/darkworld.website/privkey.pem platform/certs/privkey.pem
```

Run the deployment command again after both certificate files exist. The app container applies the public Prisma migration and versioned tenant-schema upgrades at startup; the encryption upgrade backfills legacy sensitive values, while API writes encrypt new values. PostgreSQL creates a restricted application login on first initialization; tenant schemas are created by the app DB role during provisioning. Invoice issuer details are snapshotted for future invoices and retained on reprints.

If you are on a Windows Docker host, optionally run PowerShell as Administrator to allow inbound web traffic on Domain/Private firewall profiles:

```powershell
.\scripts\Install-ProxyAccess.ps1
```

This rule is limited to ports 80 and 443. Remove it with `.\scripts\Install-ProxyAccess.ps1 -Remove`. Configure the network edge/router separately if external clients must reach the host.

Useful operations:

```powershell
docker compose ps
docker compose logs --tail 100 app nginx db
docker compose restart app
```

Nginx redirects HTTP to HTTPS and terminates TLS. Only Nginx publishes host ports; the database and app are reachable only on the private Compose network. Renew the certificate before expiry. For standalone Certbot renewal, briefly stop Nginx so Certbot can bind port 80, renew, copy the refreshed full chain/key into `certs/`, then start Nginx again:

```sh
docker compose stop nginx
sudo certbot renew --standalone
sudo install -m 0644 /etc/letsencrypt/live/darkworld.website/fullchain.pem certs/fullchain.pem
sudo install -m 0640 /etc/letsencrypt/live/darkworld.website/privkey.pem certs/privkey.pem
docker compose start nginx
```

### Provision a business

Use the protected provisioning helper from an administrator workstation:

```powershell
.\scripts\Provision-Tenant.ps1 -BaseUrl https://darkworld.website
```

It prompts for business/workspace and initial admin details. Use a unique password of at least 12 characters. The returned tenant API key is shown once; store it in a secrets manager. It is hashed in the platform database and can later be rotated under Brand settings. The provisioner does not create per-tenant VMs or containers.

The endpoint is `POST /api/v1/provision`, authorized with `x-provisioning-secret`. It validates input, creates a tenant schema and all tenant tables, creates the initial admin using bcrypt, stores only a hash of the tenant API key, and rolls back the schema if provisioning fails. Avoid putting the provisioning secret or admin password in shell history.

Sign in at the site using the exact tenant slug printed by the provisioning helper, username, and password. The slug uses lowercase letters, numbers, and hyphens; it is not the business name. Admins can add staff/admin accounts, edit the `Dark World` / `Chinnathambi Traders` branding, inventory, customer data, and UPI settings.

### Fleet and device telemetry

The super-admin fleet endpoint is protected by the same out-of-band provisioning secret:

```text
GET /api/v1/fleet
x-provisioning-secret: <operator secret>
```

`PATCH /api/v1/fleet` accepts a tenant UUID and `enabled` and/or `maintenanceMode` booleans. Disabling a tenant or enabling maintenance mode blocks new logins and invalidates existing authenticated requests; it does not delete tenant data.

Tenant clients can send `POST /api/telemetry/heartbeat` with `x-tenant-key` and a JSON payload containing `nodeId`, `clientVersion`, `operatingSystem`, `device`, `activeSessions`, `storageBytes`, and `transactionsToday`. Heartbeats contain operational metadata only. The API key is tenant-wide: rotate it under Brand settings and update devices that send heartbeats.

## GST and payments

GST arithmetic, intra-state tax splitting, inter-state IGST, rounding, HSN summaries, annual invoice exports, and invoice payment statuses run in the app. A valid GSTIN format is **not** proof of registration. Live verification requires a separately contracted/authorized GSTN/GSP provider. Configure its HTTPS endpoint and bearer token as `GSTIN_PROVIDER_URL` and `GSTIN_PROVIDER_TOKEN`; the provider must accept `POST {"gstin":"..."}` and return `{"valid":true|false}`. The app never pretends that local format validation is government verification.

The annual GST export creates an Excel workbook with invoice and HSN tax worksheets. It is a preparation aid, not a submitted GSTR return or filing/claim service. Review it with a qualified tax professional and file through an authorized GST portal/provider. UPI QR codes contain the configured merchant UPI ID and invoice amount; they do not process or confirm payments.

Invoice preview supports browser Print / Save as PDF. Thermal 58mm/80mm styles change print width. GST e-way bill/IRN issuance, e-invoicing, payment-gateway settlement, external accounting integrations, and statutory filing are not enabled unless separately integrated with authorized providers.

## Runtime resilience and data safety

The client catches React render errors, records sanitized error name/message/route (no billing snapshot, credentials, or stack trace), clears stale loading state, and can invoke only named fallback handlers registered by the app. Error reports are best-effort and rate-coalesced. A server crash, network outage, broken database, or bad deployment still requires operational recovery; no UI agent can guarantee continuous availability.

The PWA worker caches only the generic root shell, manifest, and icon. It bypasses `/api/` and never stores authentication responses or business data. Offline checkout is not implemented in this shared multi-tenant app.

Back up PostgreSQL and TLS/environment secrets independently. Test restoring backups to a separate host. Never remove the `postgres_data` volume as a troubleshooting shortcut: it contains all tenant business records. Example logical backup from the platform folder:

```sh
docker compose exec -T db sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > namma-bill-backup.sql
```

Protect and encrypt backup files, restrict access to the on-premise host, and monitor disk usage, certificates, container health, and restore readiness. Store Docker/Compose logs securely; do not enable request-body logging for authentication or provisioning routes.

## Development and checks

```powershell
npm install
npm run dev
npm test
npm run lint
```

Set `DATABASE_URL`, `JWT_SECRET` (32+ bytes), and `PROVISIONING_SECRET` (32+ bytes) in a local ignored `.env.local` for development. Apply the public schema migration with `npm run db:deploy`. Use tenant provisioning to create the first tenant; there is no public self-signup that can bypass operator controls.

The versioned API uses an in-memory login throttle and Nginx request limits. Run one app process unless a shared rate-limit store and session/telemetry operations are configured for multi-replica deployment.