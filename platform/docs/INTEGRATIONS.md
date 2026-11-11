# External Integrations — darkworld.website

## 1. Integration policy

Integrations are optional server-side adapters. Never expose provider credentials to browser code, logs, URLs, client error telemetry, or agent prompts. Require HTTPS, bounded timeouts, response validation, rate/cost controls, and a user-visible unavailable state. Configuration does not by itself establish provider authorization or regulatory compliance.

## 2. Current integration inventory

| Service | Status | Configuration | Use and limits |
|---|---|---|---|
| PostgreSQL | Required | `DATABASE_URL` plus Compose bootstrap values | Authoritative app data |
| Nginx/TLS | Required for deployment | `DOMAIN`, cert/key files | HTTPS reverse proxy and coarse rate limits |
| OpenAI-compatible chat provider | Optional, implemented | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | Bounded catalog/business assistant; no customer/invoice/payment context |
| Authorized GST verification API | Optional adapter | `GSTIN_PROVIDER_URL`, `GSTIN_PROVIDER_TOKEN` | Live verification only if contracted provider follows configured contract |
| Exchange-rate provider | Optional | `EXCHANGE_RATE_URL`, `EXCHANGE_RATE_TOKEN` | Regional rate sync; validate freshness/source |
| Template repository | Optional | `TEMPLATE_REPOSITORY_URL` | Template gallery fallback; use trusted HTTPS host |
| E-invoice provider | Optional adapter | `EINVOICE_PROVIDER_URL`, `EINVOICE_PROVIDER_TOKEN` | External submission adapter; official state depends on provider response/authorization |
| E-way provider | Optional adapter | `EWAY_PROVIDER_URL`, `EWAY_PROVIDER_TOKEN` | External workflow adapter; official status requires verified provider contract |
| Payment gateway/webhooks | Not implemented | None | Manual payment records only; no settlement callbacks |
| Email/SMS/push delivery | Not established | None | Browser alerts/prepared share links are not delivery guarantees |
| MCP | Not configured | None | Not used in runtime |
| Monitoring/error platform/object storage | Not configured by baseline | None | Choose separately after privacy and operational review |

## 3. Setup guidance

1. Obtain credentials directly from the provider's official account and documentation.
2. Confirm contract, data-processing terms, jurisdiction, quotas, sandbox, webhook/security expectations, and support escalation.
3. Store keys in the host's secret manager or protected deployment environment. Do not commit `.env`.
4. Configure only the required URL/token and restart/redeploy as documented.
5. Test against a sandbox with synthetic data before production.
6. Verify timeout, response shape, unavailable behavior, and secret redaction.

Official docs (confirm current URLs/requirements with the provider before implementation):

- OpenAI API: https://platform.openai.com/docs/
- PostgreSQL: https://www.postgresql.org/docs/
- Docker Compose: https://docs.docker.com/compose/
- Nginx: https://nginx.org/en/docs/
- Prisma: https://www.prisma.io/docs/

## 4. Provider-specific boundaries

### AI assistant

The server calls an OpenAI-compatible chat-completions endpoint. Configure base URL/model and optional API key server-side. The model receives bounded business name/catalog data only; do not add customer records, invoice/payment records, or tool execution without product/privacy/security approval. User reviews any staged draft and confirms checkout through normal billing APIs. Enforce request timeout and payload/token budgets; no automatic financial action.

### GST verification and tax

Local GSTIN format validation is not government registration verification. The configured authorized provider must accept the request/response contract documented in the platform README. Handle provider unavailability distinctly; never turn a timeout into a valid result. GST calculation/export does not file returns or submit statutory claims.

### Exchange rates and templates

Treat results as externally sourced, validate the schema, source timestamp, and upper bounds. Do not let an external template response inject executable markup or alter authorization. Cache only safe public data with explicit TTL if later implemented.

### E-invoice/e-way

Provider adapters require business authorization, correct idempotency, exact payload/response mapping, and safe retry semantics. Confirm whether a request was accepted before retrying. Do not state that official registration/issuance is complete based only on a generic HTTP success.

### Payments

Payment gateway settlement and inbound webhooks are not currently implemented. A future integration needs an approved provider, signature verification using raw body, replay/idempotency controls, authoritative amount/currency/order validation, reconciliation, and a durable event log. Never mark invoice paid based on a client redirect or unsigned callback.

## 5. Timeouts, retries, errors, and cost

- Existing outbound calls use short explicit timeouts in several routes; keep timeout budgets route-specific.
- Retry only safe idempotent reads or provider-documented idempotent operations, with bounded backoff/jitter.
- Do not retry invoice/payment writes unless protected by idempotency keys and reconciliation.
- Classify auth/config, rate-limit, timeout, provider-5xx, and invalid-response errors; return generic safe client messages.
- Track provider call count, latency, status class, timeout, and cost metadata without request content or credentials.
- Set per-tenant/global quotas for paid AI/external APIs; alert before provider limit exhaustion.
- Fail optional integrations independently so core billing remains available where safe.

## 6. Security controls

- Validate provider URL scheme and host; prevent SSRF, DNS rebinding/private-network access, and redirects to untrusted hosts.
- For user-configured integrations, enforce a strict HTTPS host allowlist or approved configuration flow.
- Store tenant provider secrets encrypted and restrict reads to server-side integration handlers.
- Never return decrypted secrets from admin configuration APIs; return masked state.
- Do not log Authorization headers, raw provider bodies containing PII, full URLs with query secrets, or prompts.
- Rotate credentials and test revocation.

## 7. Testing and monitoring

For every provider, test valid success, malformed response, invalid credentials, quota/rate-limit response, timeout, connection failure, oversized response, and duplicate/replay behavior where relevant. Use mocked HTTP in unit tests and provider sandbox in staging.

Useful current commands from `platform/`:

```powershell
npm test
npm run lint
npm run build
```

Production observability should record sanitized integration name, tenant-safe identifier, operation, duration, and status category. Do not enable body logging to debug provider errors. See [TESTING.md](./TESTING.md) and [DEBUGGING.md](./DEBUGGING.md).

## 8. Adding a new integration

Require product owner and security/privacy approval; add a server-only typed adapter; add explicit configuration validation and timeouts; validate request/response schemas; scope credentials and payload per tenant; define idempotency/retry/cost policy; add mocked and sandbox tests; update API, SETUP, AGENTS, and this document.
