# darkworld.website Scalability, Database, and Reliability Guide

This guide maps the requested scaling checklist to the current `platform/` deployment. It is an implementation roadmap, not a claim that the listed infrastructure is already deployed. Confirm expected traffic, budget, hosting provider, and recovery objectives before choosing managed services or capacity targets.

## Current baseline

- The application is a Next.js/Prisma service with PostgreSQL and Nginx, deployed as one app container, one database container, and one reverse-proxy container using Docker Compose.
- PostgreSQL has a Compose health check. The app exposes `/api/health`, which checks database connectivity. The Compose app and Nginx services do not currently define container health checks.
- Nginx terminates TLS and applies per-IP connection and API request limits. The platform also has an in-memory login throttle; the deployment guide explicitly recommends one app process until shared rate-limit and related state are configured.
- Tenants use separate PostgreSQL schemas on the same cluster. The app caches a Prisma client per tenant schema, so connection use can grow with the number of active tenant clients and app replicas.
- A number of list endpoints return a fixed, bounded batch (often up to 200 rows); general cursor pagination is not yet a platform-wide API pattern.
- PostgreSQL backup is documented as a manual `pg_dump` operation. The deployment does not include automated point-in-time recovery, a standby database, or tested automatic failover.
- Redis, a durable job queue, a CDN, autoscaling, and a production metrics/alerting stack are not part of the current Compose deployment.

## Target architecture

```text
Users
  -> DNS / CDN / WAF (static assets; API and private data bypass shared caching)
  -> HTTPS load balancer
  -> Nginx or managed ingress
  -> stateless Next.js app replicas
       -> Redis (shared rate limits, carefully scoped cache, queue coordination)
       -> durable job queue -> background worker replicas
       -> PgBouncer or managed connection pool -> PostgreSQL primary
                                                   -> optional read replicas
  -> centralized logs, metrics, traces, and alerting
```

Keep PostgreSQL and Redis on private networks. The CDN and load balancer should forward the original client address only through trusted proxy configuration; rate limits must not trust arbitrary client-supplied forwarding headers.

## Scale the application

### 1. Vertical scaling first

Measure CPU, memory, event-loop lag, request latency, database latency, and connection count under representative load. Increase host/container resources when a single app or database node is resource-bound and measurements show that vertical capacity is the simplest cost-effective step. Set container resource limits and leave operating-system and database headroom.

### 2. Multiple app servers and load balancing

Before adding replicas:

1. Move process-local throttles and any coordination state to a shared store; otherwise each replica applies a different limit.
2. Keep sessions verifiable on every replica using the same protected signing configuration. Do not rely on sticky sessions as a substitute for shared state.
3. Ensure uploads, generated artifacts, and other mutable files are not held only on a container filesystem.
4. Run schema migrations once as a controlled release step before routing traffic to the new version, rather than having every replica race to migrate at startup.
5. Add graceful shutdown/readiness behavior so a replica stops receiving requests before it exits.

Then place replicas behind a managed load balancer or redundant ingress. Start with a fixed, small replica count and verify tenant routing, login throttling, invoice creation, and shutdown behavior across replicas.

### 3. Autoscaling

Autoscale app replicas using sustained CPU and/or request concurrency/latency, with minimum and maximum replica counts, cooldowns, and deployment safeguards. Do not scale only on CPU: database saturation can make more replicas worsen an outage. Include the maximum potential database connections in the scaling limit. Scale workers independently based on queue depth and oldest-job age.

### 4. CDN

Use the CDN for versioned static assets, icons, and other immutable public content. Keep authentication, tenant API responses, invoices, customer data, and private logos out of shared caches; preserve explicit `no-store` behavior for sensitive API responses. If private media is moved to object storage, serve it through authorization checks or short-lived signed URLs, not a public cache key.

## Database growth and data access

### 1. Indexes and query plans

Use production-shaped data and `EXPLAIN (ANALYZE, BUFFERS)` to identify slow queries before adding indexes. Add tenant-schema indexes for measured filter/order patterns, such as invoice list ordering and common invoice/payment lookups, and deploy them with migrations. Check write overhead, disk use, and index effectiveness after deployment. Do not add indexes to every column.

### 2. Connection pooling

Budget connections across all app replicas and tenant Prisma clients, leaving room for migrations, administration, and failover. Configure Prisma pool limits/timeouts and monitor pool wait time and PostgreSQL connection utilization. The current per-tenant Prisma client cache can multiply pools; measure this with realistic tenant counts before increasing replicas.

If adding PgBouncer or a managed pooler, validate Prisma and the tenant-specific `schema` URL behavior with the selected pool mode before rollout. Test that concurrent requests for different tenant schemas never cross tenant boundaries. Keep a direct, controlled connection path for migrations if the chosen pooler requires it.

### 3. Replication and read/write behavior

Keep invoice creation, inventory changes, payments, and other correctness-sensitive writes on the primary. Add a read replica only after read load is measured and the application can tolerate replication lag for explicitly identified read-only views. Do not use a lagging replica for authorization, inventory availability, payment status, or a read immediately following a user write unless consistency is guaranteed.

### 4. Pagination

Replace unbounded or fixed-size list retrieval with explicit, bounded page APIs. Prefer cursor/keyset pagination for large histories, ordered by a stable unique pair (for example `issuedAt` plus `id`) with a matching index. Validate page size and cap it server-side. Keep a total-count query optional because counts can be expensive at scale.

### 5. Sharding

Do not shard as an initial scaling step. First tune queries and indexes, pool connections, scale vertically, and consider read replicas. If a single PostgreSQL primary remains the measured bottleneck, assess separating high-volume tenants or tenant groups into independent database clusters. This requires tenant-to-cluster routing, migration/backup/failover automation, and operational tooling; schema-per-tenant on one cluster is not itself database sharding.

### 6. Backups and failover

- Automate encrypted backups to storage outside the database host/account and restrict access.
- Define and approve recovery point objective (RPO) and recovery time objective (RTO) before choosing backup frequency and HA topology.
- Use PostgreSQL WAL archiving/point-in-time recovery where supported; retain periodic full backups according to an explicit retention policy.
- Perform scheduled restore drills into an isolated environment and verify application-level data, tenant schemas, and encryption-key availability.
- For higher availability, use a managed PostgreSQL HA configuration or a tested primary/standby design with monitored replication and automated or documented failover.
- Document connection recovery, DNS/endpoint changes, pool reconnection, backup restoration, and failback. A backup is not a failover system.

## Caching, rate limits, and background work

### Redis cache

Add Redis only for measured use cases such as shared rate limits, short-lived derived data, or coordination. Cache keys must include the tenant identity and all relevant authorization/version dimensions. Set TTLs, bound memory, define eviction behavior, and invalidate on writes. Never use a cache as the source of truth for stock, invoices, or payments. Treat Redis unavailability as an explicit degraded mode and decide which paths fail closed (for example, abuse controls) versus bypass cache.

### Rate limiting

Retain an edge-level limit for broad abuse protection, and add shared application-level limits keyed by authenticated tenant/user and sensitive operation. Tune limits from measured normal traffic, return a clear `429` with `Retry-After` where appropriate, and ensure the client address is derived only from trusted proxies. Include the login endpoint and expensive exports/integrations in the policy.

### Queue and background jobs

Move slow, retryable, non-interactive work (for example, large exports, notifications, and scheduled maintenance) to a durable queue with separate worker processes. Keep checkout, invoice and payment state changes synchronous and transactional so the user receives a definitive result.

For work triggered by a database write, use an outbox record committed in the same transaction, then publish it to the queue. Make jobs idempotent, retry only transient failures with bounded exponential backoff and jitter, route exhausted jobs to a dead-letter queue, and provide job visibility/replay controls. Never log secrets or customer/payment payloads in job diagnostics.

## Reliability and operations

### Health checks

Keep a lightweight liveness check separate from readiness. Readiness should fail if the instance cannot serve requests safely (including required database connectivity); liveness should not trigger restart loops for a temporary dependency outage. Configure container/orchestrator health checks for the app and ingress, and monitor the existing database health check and `/api/health` endpoint.

### Timeouts, retries, and circuit breakers

Set explicit timeouts for inbound requests, database operations, queue jobs, and external providers. Retry only transient errors, only for idempotent operations, with a small bounded attempt count and jitter. Use idempotency keys for retried payment or invoice requests. Add circuit breakers around unreliable external integrations, with a visible unavailable/degraded response and controlled recovery probes. Avoid retries at multiple layers that multiply load.

### Monitoring and alerts

Centralize structured logs, metrics, and traces with request IDs and tenant-safe identifiers; do not capture credentials, request bodies, or customer/financial PII. Monitor:

- Request rate, error rate, p50/p95/p99 latency, saturation, and health/readiness.
- App CPU/memory, restarts, event-loop lag, and replica count.
- Database CPU, storage, connections/pool waits, slow queries, locks, replication lag, and backup age.
- Queue depth, oldest-job age, retries, dead-letter count, and worker availability.
- TLS expiry, disk capacity, restore-test results, and failover status.

Alert on actionable thresholds with an owner and runbook. Establish SLOs and baseline thresholds from real traffic rather than copying arbitrary numbers.

### Load testing with k6

Create staged k6 tests against a staging environment with production-like database shape. Cover sign-in, product/customer search, invoice listing, concurrent invoice creation/stock contention, payment updates, exports, and mixed tenant traffic. Include ramp-up, steady-state, and spike/soak phases. Set explicit latency/error-rate acceptance criteria from the service SLO, check for data correctness and overselling, and monitor app/database/queue metrics during each run. Avoid load testing production without an approved window and guardrails.

### Graceful degradation

Keep core billing paths available when optional providers or noncritical services fail. Show clear status for unavailable tax verification, AI, notifications, analytics, or queued exports; allow safe retry where appropriate. Do not report payment or invoice success until the authoritative transaction commits. For database loss or uncertain transaction outcomes, fail visibly and require safe reconciliation rather than silently accepting writes.

## Suggested rollout order

1. **Baseline and recovery:** document SLO/RPO/RTO, instrument the single deployment, automate encrypted backups, and complete a restore drill.
2. **Database efficiency:** inspect slow queries, add evidence-based indexes, paginate large lists, and configure/measure Prisma connection limits.
3. **Application resilience:** add health/readiness and graceful shutdown, explicit timeouts, safe idempotency, and dependency degradation behavior.
4. **Shared infrastructure:** introduce shared rate limiting and a durable queue/worker only for justified use cases; test tenant isolation and failure behavior.
5. **Horizontal app scale:** deploy multiple replicas behind a load balancer after removing process-local coordination assumptions; run k6 tests and verify connection budgets.
6. **Edge and database HA:** add a CDN for public static content, then database replication/managed failover if measured demand and recovery objectives justify it.
7. **Autoscaling and sharding:** autoscale against validated signals; consider sharding only when the simpler stages no longer meet measured SLOs.

## Release checklist

- [ ] Capacity, traffic assumptions, SLO, RPO, and RTO are documented.
- [ ] Backup encryption, off-host retention, and restore drill are verified.
- [ ] Tenant-specific DB routing and pool limits are tested under concurrency.
- [ ] All large list endpoints have bounded pagination and suitable query/index plans.
- [ ] Multi-replica rate limiting and session behavior are tested.
- [ ] Queue jobs are idempotent, observable, retry-bounded, and tenant-scoped.
- [ ] CDN rules explicitly bypass private APIs and business data.
- [ ] k6 acceptance thresholds and rollback criteria pass in staging.
- [ ] Monitoring, alerts, and operator runbooks cover app, database, queue, and recovery.
