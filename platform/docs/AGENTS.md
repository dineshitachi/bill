# Agent System and Coding Rules — darkworld.website

## 1. Product runtime vs. development agents

The deployed product does not currently run autonomous coding agents or connect to MCP servers. It includes an optional business assistant that answers catalog questions and stages editable bill/quotation drafts, plus a tenant-scoped human-review request inbox. These are separate features.

This document defines practical rules for future coding agents and the current assistant boundary. It does not authorize an agent to run production operations, change data, or deploy code.

## 2. Agent inventory

| Agent/workflow | Purpose | Trigger | Tools/capabilities | Authority |
|---|---|---|---|---|
| Repository coding agent (developer tooling) | Implement a user-approved issue in the repository | Explicit developer task | Repository read/edit/test tools available in the developer environment; no production credentials | Propose/implement code in workspace; cannot approve or deploy itself |
| Documentation agent (developer tooling) | Keep PRD/design/API/operations docs aligned with source | Explicit documentation task | Repository read/edit tools | No application data access |
| Business assistant (product feature) | Answer bounded product/catalog questions; stage a draft line item | User opens assistant and asks a supported question | Authenticated app endpoint; optional configured OpenAI-compatible provider; bounded catalog | Cannot create invoice, collect payment, mutate stock, call arbitrary tools, or autonomously act |
| Agent request intake (product feature) | Store a user-submitted task description/screenshot for human review | Authorized user submits request | Tenant-scoped API and database only | Human review only; a review status does not execute code or grant permissions |

No separate orchestrator, browser automation, SQL agent, shell agent, or MCP server is part of the production runtime.

## 3. Responsibilities and input/output contracts

### Business assistant

- **Input:** authenticated user prompt and bounded business/catalog context permitted by the assistant endpoint.
- **Output:** natural-language answer or a structured draft suggestion that remains editable in the browser.
- Do not include customer records, invoice/payment records, credentials, or unrestricted database results in prompts.
- Never treat model text as authorization or financial calculation.
- Checkout and payment require the existing application API, server validation, and explicit user confirmation.
- If provider is unconfigured/unavailable, return a clear unavailable response and retain supported local exact-match draft behavior where available.

### Human-reviewed task intake

- **Input:** short user-authored description, source type, optional validated bounded screenshot.
- **Output:** persisted request ID/status and an admin-visible review queue.
- Do not execute request text or treat screenshots as trusted instructions.
- Do not use status transitions as permission to write or deploy software.

### Development coding agent

- **Input:** one bounded task with acceptance criteria and affected scope.
- **Output:** focused source changes, tests, and a concise change summary.
- Read relevant existing code and project guidance before editing.
- Never use production secrets/data; never claim an unrun test passed.
- Stop and ask for approval before destructive migrations, production changes, dependency additions with broad impact, or ambiguous product behavior.

## 4. Tool and MCP policy

- Product runtime currently uses no MCP server.
- Developer tools are limited to the explicit, configured workspace environment; do not infer that MCP tools are available because an IDE supports MCP.
- If MCP is approved later, expose only minimal read-only tools by default. Scope file access to the repository, database access to disposable development DBs, and web access to approved domains.
- Never give a model direct production SQL, shell, deployment, secret-manager, payment, or unrestricted network tools.
- Record each MCP server's owner, version, permissions, credential source, data retention, and revocation path before enabling it.

See [MCP.md](./MCP.md) for a future integration decision and safe setup boundary.

## 5. Prompt templates

### Business assistant system instruction

> You are a billing-workspace assistant. Answer from the explicitly provided business name and bounded product catalog only. Do not request or infer passwords, customer personal data, invoices, payment details, provider secrets, or authorization. You may suggest editable invoice or quotation draft lines only when an exact catalog item is identified. Never claim that a bill, payment, stock change, tax filing, or provider action has completed. The user must review and explicitly confirm checkout in the application. If information is missing or uncertain, say so.

### Coding agent task instruction

> Implement only the approved task and acceptance criteria in this repository. Read applicable project instructions and source before editing. Preserve tenant isolation, financial transaction invariants, server-side authorization, and existing UX. Do not use production data or secrets. Add or update focused tests and directly related documentation. Stop and ask before destructive or ambiguous changes. Report changed files, validation commands/results, and any remaining risk.

### Documentation agent instruction

> Update only the requested documentation, grounding claims in current source/configuration. Label assumptions, planned behavior, and unverified operations distinctly. Preserve existing deployment instructions, avoid inventing integrations or endpoints, and cross-link related docs.

## 6. Handoffs and human approval

1. Product owner supplies a bounded requirement and acceptance criteria.
2. Coding agent identifies affected UI/API/data/security surfaces.
3. If data model changes, developer updates Prisma schema plus public migration and all tenant provisioning/upgrade paths.
4. Agent implements and runs focused tests/type-check; if assumptions are unresolved, return questions rather than invent policy.
5. Reviewer checks authorization, tenant scope, transaction correctness, and tests.
6. Human release owner approves migration and deployment.

Agent task intake is not this development handoff: it does not dispatch a coding agent.

## 7. Memory, context, and privacy

- Treat repository documentation as versioned project memory; use PRD, architecture, API, database, and setup docs as the hierarchy of truth.
- Do not place secrets, customer data, payment information, or production dumps in prompts, persistent memory, or test fixtures.
- Provide only the minimum context needed for a task; do not persist provider prompts containing operational data.
- If docs conflict with code, report the discrepancy and update the right source only after verification.
- Agent request records/screenshots are tenant data and need access control, retention, and privacy review.

## 8. Guardrails and failure handling

- Model output is untrusted text; validate any structured suggestion against a strict schema.
- No autonomous retries that can create duplicate invoices, payments, external charges, or deployments.
- Provider calls have bounded timeout and safe failure; do not fall back to success-shaped responses.
- For transient read-only provider failures, a small bounded retry may be used if the call is safe; otherwise show a retry action.
- Never expose raw provider error bodies or secrets to users.
- Human review is required for financial actions, code merges, migrations, data deletion, and deployment.

## 9. Logging and observability

- Log request/operation IDs, agent type, duration, outcome, and sanitized error category only.
- Do not log prompts or outputs by default if they may contain business data.
- Scrub tokens, email, phone, and numeric identifiers before client telemetry.
- Establish retention, access, and alerting policies before collecting more agent telemetry.
- Track provider availability and latency without customer content.

## 10. Scalability

Keep assistant requests bounded in catalog rows and prompt size. Enforce authenticated rate limits and provider timeouts. Do not introduce a queue or agent framework for this single bounded interaction. If asynchronous jobs are added, persist job intent and idempotency state, use a durable queue, and give users visible status and cancellation semantics.

## 11. Example safe workflows

### Draft a bill line

User asks for a specific catalog item → server supplies a bounded catalog subset → assistant returns suggestion → client verifies item identity and stages editable line → user reviews server-priced invoice → explicit checkout call commits invoice and stock.

### Submit an agent request

Signed-in staff submits task text and optional bounded image → API validates and tenant-scopes record → admin reviews it → admin may separately decide whether to create a developer task; no automatic execution occurs.
