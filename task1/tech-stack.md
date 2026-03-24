# Technology Justification

---

## Backend Framework — NestJS (TypeScript)

**Why:** WebiU already uses NestJS. Staying on it means zero migration cost, reuse
of existing modules (`GithubService`, `CacheService`, `ThrottlerModule`), and
contributor familiarity. NestJS's modular architecture makes it straightforward to
add a `WebhookModule`, `WorkerModule`, and `AdminModule` without restructuring existing
code.

**Alternative considered:** Express.js — less opinionated, smaller, but lacks the
dependency injection and module system that makes NestJS easy to extend.

---

## Job Queue — BullMQ (Redis-backed)

**Why:** BullMQ provides durable queues, retry with backoff, dead-letter queues,
concurrency control, and a cron scheduler — all the things needed for a reliable
ingestion layer. Jobs survive worker restarts because they are persisted in Redis.
Rate limit backpressure is implemented by pausing a queue when `X-RateLimit-Remaining`
drops below a threshold.

**Alternative considered:** Agenda (MongoDB-backed) — good for cron, poor for
high-throughput job processing. Bull (predecessor to BullMQ) — BullMQ is the
maintained successor with better TypeScript support.

---

## Primary Cache — Redis (Upstash for serverless targets)

**Why:** Sub-millisecond reads, native TTL support, supports `ETag` string storage,
and is the backing store for BullMQ. A single Redis instance serves both the cache
layer and the job queue. For serverless functions (Vercel), Upstash Redis provides
the same interface over HTTP — no persistent connection required.

**Alternative considered:** Memcached — no native data structure support (no sorted
sets for rate limit windows), no persistence.

---

## Persistent Storage — PostgreSQL

**Why:** Structured data (repos, contributors, languages, releases) fits a relational
model naturally. Foreign keys enforce referential integrity between repos and their
contributors. `tsvector` full-text search indexes enable project search without an
external search engine. Read replicas scale read throughput at 10,000 repos without
schema changes.

**Alternative considered:** MongoDB — flexible schema is useful during early design,
but the data model here is well-defined and relational. MongoDB's lack of joins would
force application-level joins for contributor aggregation queries.

---

## Object Storage — S3 (or compatible)

**Why:** README blobs and AI summaries can be several kilobytes each. Storing them in
PostgreSQL `TEXT` columns inflates row size, slows index scans, and increases backup
size. S3-compatible storage (AWS S3, Cloudflare R2, MinIO for self-hosted) is cheap,
durable, and CDN-friendly.

---

## API — REST + GraphQL (Apollo)

**Why both:** REST is the right default for simple, cacheable, single-resource reads
(`GET /api/v1/projects`, `GET /health`). HTTP caching (`Cache-Control`, `ETag`) works
natively with REST. GraphQL adds value only for multi-source views where the client
needs to compose data from multiple service calls in one request. WebiU uses both:
REST for lists and simple detail pages, GraphQL for `ProjectDetails` and
`ContributorProfile` views that currently require 2-3 separate REST calls.

---

## Frontend — Angular 17+ (Standalone Components)

**Why:** Existing codebase. Standalone components and the new `HttpInterceptorFn`
functional API make it straightforward to add an HTTP cache interceptor without
modifying the module structure. The Angular service worker enables optional offline
caching for project list pages.

---

## CI/CD — GitHub Actions

**Why:** Already in the repo. No new tooling to introduce. Native integration with
GHCR for container publishing. `act` enables local workflow testing before pushing.

---

## Deployment — Docker + Vercel (hybrid)

**Why hybrid:** The NestJS server (stateful, persistent process with in-memory cache)
is deployed as a Docker container. Stateless routes (project search, contributor stats,
AI pipeline) are deployed as Vercel serverless functions backed by Upstash Redis.
This gives the best of both: persistent process for stateful operations, serverless
for high-concurrency stateless reads.

---

## Monitoring — Prometheus + Winston

**Why:** `@willsoto/nestjs-prometheus` integrates with NestJS's existing DI container.
Winston + AsyncLocalStorage (already in PR #491) provides structured, correlation-ID-
tagged logs readable by any log aggregator. No vendor lock-in.

---

## Summary Table

| Layer | Technology | Reason |
|---|---|---|
| Backend framework | NestJS + TypeScript | Existing codebase, modular DI |
| Job queue | BullMQ | Durable, backoff, cron, TypeScript-native |
| L1 cache | In-process Map | Zero-latency, node-local |
| L2 cache | Redis / Upstash | Shared, TTL, ETag storage, BullMQ backing |
| Persistent storage | PostgreSQL | Relational, read replicas, full-text search |
| Blob storage | S3-compatible | Large text, CDN-friendly, cheap |
| API protocol | REST + GraphQL | REST for cacheable, GraphQL for multi-source |
| Frontend | Angular 17+ | Existing codebase |
| CI/CD | GitHub Actions | Existing, native GHCR integration |
| Deployment | Docker + Vercel | Stateful + stateless hybrid |
| Monitoring | Prometheus + Winston | No lock-in, existing logging layer |
