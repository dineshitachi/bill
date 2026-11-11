# MCP Connection Guide — darkworld.website

## 1. Current status

The deployed application does not currently connect to Model Context Protocol (MCP) servers. No MCP SDK, server list, MCP environment variables, or production MCP tool registry is part of the current application contract. Core billing does not require MCP.

The optional product assistant calls a configured OpenAI-compatible chat-completions provider from a server route; that is not an MCP connection. IDE/developer MCP services are separate from the product runtime.

## 2. Recommendation

Do not add MCP for the MVP. Add it only for a specific approved use case that cannot be served more simply with a narrow server-side API. Potential future read-only use cases might include a scoped catalog lookup or approved documentation search. Do not grant direct database, shell, deployment, payment, filesystem-wide, or secret-manager access to a model.

## 3. Future trust boundary

```text
Authenticated user
  -> app server policy and tenant authorization
  -> allowlisted tool adapter
  -> MCP client (server-side credentials)
  -> explicitly approved MCP server/tool
```

The browser must never connect directly to an MCP server with privileged credentials. Model tool output is untrusted input and must be schema-validated before display or any downstream use.

## 4. Approval and design requirements

Before implementation, record:

- Business use case and non-MCP alternatives.
- MCP server owner, source, version/pinning and update process.
- Exact tools and schemas allowed; default to read-only and deny all others.
- Tenant/user scope propagation and verification at the tool boundary.
- Credential source, rotation/revocation, network egress allowlist, and data residency.
- Prompt/tool data retention, audit strategy, rate limits, and cost cap.
- Failure behavior and whether the user can proceed without the tool.
- Human approval for any write action; financial and deployment actions remain prohibited.

## 5. Agent alignment

The current assistant can answer from limited catalog data and stage an editable draft; it cannot finalize checkout or record payments. Agent task intake is human-reviewed text/image storage, not tool execution. See [AGENTS.md](./AGENTS.md). If MCP is introduced, preserve these limits and do not use model output as authorization.

## 6. Safe future rollout

1. Prototype against a local mock MCP server with synthetic data.
2. Define a typed allowlist adapter in `src/server/`; do not expose a generic `callTool(name,args)` API to clients.
3. Authenticate user and tenant before constructing allowed tool context.
4. Validate tool input/output, set strict timeouts and payload limits, and handle unavailability explicitly.
5. Add tests for cross-tenant access, prompt injection, invalid tool output, timeout, server compromise assumptions, and secret redaction.
6. Run a privacy/security review and obtain product/security approval before staging access.
7. Enable for a small approved tenant cohort behind a feature flag; monitor and retain only sanitized metadata.

## 7. Configuration and operations

No MCP configuration is required today. If approved, use server-only variables such as a named endpoint and credential reference; do not invent shared generic credentials or commit them. Document transport (stdio/HTTP), authentication, TLS, allowed egress, health behavior, version compatibility, and shutdown lifecycle after choosing the server.

## 8. Testing and troubleshooting

There are no current MCP tests or commands. Future tests must use an isolated mock server and never contact production tools by default. Diagnose transport/handshake, authentication, server capability mismatch, schema validation, timeout, rate limiting, and policy denial separately. Logs must not store prompts, secrets, or returned customer content.

## 9. Adding a server

An approved addition requires a threat model, tool allowlist, version/owner record, typed adapter, tests, setup documentation, rate/cost limits, incident disable switch, and human reviewer. If a safe narrow internal API meets the need, prefer it over MCP.
